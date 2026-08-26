import { ConfigService } from '@nestjs/config';
import type { ApiPromise } from '@polkadot/api';
import { CID } from 'multiformats/cid';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { CpsSnapshotService } from './cps-snapshot.service.js';
import { RobonomicsService } from './robonomics.service.js';

const TEST_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

describe('CpsSnapshotService', () => {
  it('читает настроенные NodeId на одном финализированном блоке', async () => {
    const blockHash = { toString: () => '0xfinalized' };
    const at = jest.fn().mockResolvedValue({
      isNone: false,
      unwrap: () => ({
        get: (key: string) =>
          key === 'owner'
            ? { toString: () => '5Owner' }
            : {
                isNone: false,
                unwrap: () => ({ toU8a: () => CID.parse(TEST_CID).bytes }),
              },
      }),
    });
    const api = {
      rpc: {
        chain: {
          getFinalizedHead: jest.fn().mockResolvedValue(blockHash),
          getHeader: jest.fn().mockResolvedValue({
            number: { toNumber: () => 321 },
          }),
        },
      },
      query: { cps: { nodes: { at } } },
    } as unknown as ApiPromise;
    const upsertAnchor = jest.fn().mockResolvedValue(undefined);
    const config = {
      get: jest.fn((key: string, fallback: unknown) =>
        key === 'cps.nodeIds' ? ['0', '42'] : fallback,
      ),
    } as unknown as ConfigService;
    const service = new CpsSnapshotService(
      config,
      {
        getApi: jest.fn().mockResolvedValue(api),
      } as unknown as RobonomicsService,
      { upsertAnchor } as unknown as CpsAnchorRepository,
    );

    await expect(service.snapshot()).resolves.toBe(2);
    expect(at).toHaveBeenNthCalledWith(1, blockHash, '0');
    expect(at).toHaveBeenNthCalledWith(2, blockHash, '42');
    expect(upsertAnchor).toHaveBeenNthCalledWith(1, {
      nodeId: '0',
      block: 321,
      cid: TEST_CID,
      owner: '5Owner',
    });
  });
});
