import type { ApiPromise } from '@polkadot/api';
import type { Event } from '@polkadot/types/interfaces';
import { ConfigService } from '@nestjs/config';
import { CID } from 'multiformats/cid';
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
    handler = new CpsPayloadSetHandler(
      { getApi } as unknown as RobonomicsService,
      { upsertAnchor } as unknown as CpsAnchorRepository,
      { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService,
    );
  });

  it('читает историческое состояние и ставит binary CID в очередь', async () => {
    await handler.handle(event, 123, true);

    expect(getBlockHash).toHaveBeenCalledWith(123);
    expect(at).toHaveBeenCalledWith(blockHash, nodeId);
    expect(upsertAnchor).toHaveBeenCalledWith({
      nodeId: 42n,
      block: 123,
      cid: TEST_CID,
      owner: '5Owner',
    });
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

  it('fail-closed отклоняет UTF-8 CID из устаревшего README', async () => {
    at.mockResolvedValue({
      isNone: false,
      unwrap: () => ({
        get: () => ({
          isNone: false,
          unwrap: () => ({
            toU8a: () => new TextEncoder().encode(TEST_CID),
          }),
        }),
      }),
    });

    await expect(handler.handle(event, 123, true)).rejects.toThrow(
      'CPS payload does not contain a binary IPFS CID',
    );
    expect(upsertAnchor).not.toHaveBeenCalled();
  });
});
