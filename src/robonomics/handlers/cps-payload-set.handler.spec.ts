import type { ApiPromise } from '@polkadot/api';
import type { Event } from '@polkadot/types/interfaces';
import { ConfigService } from '@nestjs/config';
import { CID } from 'multiformats/cid';
import { CpsPayloadSource } from '../../common/constants/connectivity-storage.enum.js';
import { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import { RobonomicsService } from '../robonomics.service.js';
import { CpsPayloadSetHandler } from './cps-payload-set.handler.js';

const TEST_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

describe('CpsPayloadSetHandler', () => {
  const nodeId = { toBigInt: () => 42n };
  const owner = { toString: () => '5Owner' };
  const event = { data: [nodeId, owner] } as unknown as Event;
  const blockHash = { toString: () => '0x1234' };
  const payloadBytes = CID.parse(TEST_CID).bytes;
  let at: jest.Mock;
  let getBlockHash: jest.Mock;
  let getApi: jest.Mock;
  let upsertAnchor: jest.Mock;
  let isPayloadSet: jest.Mock;
  let handler: CpsPayloadSetHandler;

  /**
   * Создаёт обработчик с заданным realtime allowlist NodeId.
   * @param configuredNodeIds - разрешённые числовые NodeId
   * @returns обработчик CPS-событий
   */
  function createHandler(
    configuredNodeIds: string[] = [],
  ): CpsPayloadSetHandler {
    const config = {
      get: jest.fn((key: string, fallback: unknown) => {
        if (key === 'cps.enabled') return true;
        if (key === 'cps.nodeIds') return configuredNodeIds;
        return fallback;
      }),
    } as unknown as ConfigService;

    return new CpsPayloadSetHandler(
      { getApi } as unknown as RobonomicsService,
      { upsertAnchor } as unknown as CpsAnchorRepository,
      config,
    );
  }

  beforeEach(() => {
    at = jest.fn().mockResolvedValue({
      isNone: false,
      unwrap: () => ({
        get: () => ({
          isNone: false,
          unwrap: () => ({ toU8a: () => payloadBytes }),
        }),
      }),
    });
    getBlockHash = jest.fn().mockResolvedValue(blockHash);
    isPayloadSet = jest.fn().mockReturnValue(true);
    const api = {
      events: { cps: { PayloadSet: { is: isPayloadSet } } },
      rpc: { chain: { getBlockHash } },
      query: { cps: { nodes: { at } } },
    } as unknown as ApiPromise;
    getApi = jest.fn().mockResolvedValue(api);
    upsertAnchor = jest.fn().mockResolvedValue(undefined);
    handler = createHandler();
  });

  it('при пустом CPS_NODE_IDS принимает любой NodeId', async () => {
    await handler.handle(event, 123, true);

    expect(getBlockHash).toHaveBeenCalledWith(123);
    expect(at).toHaveBeenCalledWith(blockHash, nodeId);
    expect(upsertAnchor).toHaveBeenCalledWith({
      nodeId: 42n,
      block: 123,
      payloadSource: CpsPayloadSource.Ipfs,
      cid: TEST_CID,
      owner: '5Owner',
    });
  });

  it('принимает NodeId из настроенного CPS_NODE_IDS', async () => {
    handler = createHandler(['42']);

    await handler.handle(event, 123, true);

    expect(upsertAnchor).toHaveBeenCalledWith(
      expect.objectContaining({ nodeId: 42n }),
    );
  });

  it('пропускает NodeId вне настроенного CPS_NODE_IDS до чтения storage', async () => {
    handler = createHandler(['7']);

    await handler.handle(event, 123, true);

    expect(getBlockHash).not.toHaveBeenCalled();
    expect(at).not.toHaveBeenCalled();
    expect(upsertAnchor).not.toHaveBeenCalled();
  });

  it('пропускает событие неуспешного экстринсика', async () => {
    await handler.handle(event, 123, false);

    expect(getApi).not.toHaveBeenCalled();
    expect(upsertAnchor).not.toHaveBeenCalled();
  });

  it('пропускает событие, не совпавшее с runtime metadata', async () => {
    isPayloadSet.mockReturnValue(false);

    await handler.handle(event, 123, true);

    expect(getBlockHash).not.toHaveBeenCalled();
    expect(upsertAnchor).not.toHaveBeenCalled();
  });

  it('не создаёт anchor для отсутствующего CPS payload', async () => {
    at.mockResolvedValue({ isNone: true });

    await handler.handle(event, 123, true);

    expect(upsertAnchor).not.toHaveBeenCalled();
  });

  it('ставит не-CID байты в очередь как прямой chain payload', async () => {
    const chainPayload = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a]);
    at.mockResolvedValue({
      isNone: false,
      unwrap: () => ({
        get: () => ({
          isNone: false,
          unwrap: () => ({
            toU8a: () => chainPayload,
          }),
        }),
      }),
    });

    await expect(handler.handle(event, 123, true)).resolves.toBeUndefined();
    expect(upsertAnchor).toHaveBeenCalledWith({
      nodeId: 42n,
      block: 123,
      payloadSource: CpsPayloadSource.Chain,
      chainPayload,
      owner: '5Owner',
    });
  });
});
