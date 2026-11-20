import type { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import type { RobonomicsService } from '../robonomics/robonomics.service.js';
import {
  CpsSensorIdentityService,
  CpsSensorRejection,
} from './cps-sensor-identity.service.js';

/** Дерево CPS одного блока: узлы, родители, identity. */
interface Tree {
  readonly parents: Record<string, string | null>;
  readonly identities: Record<string, Uint8Array>;
  readonly children: Record<string, string[]>;
}

function key(byte: number): Uint8Array {
  return new Uint8Array(32).fill(byte);
}

function hex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('hex');
}

function some<T>(value: T) {
  return { isNone: false, unwrap: () => value };
}

const none = {
  isNone: true,
  unwrap: () => {
    throw new Error('Option is None');
  },
};

/** ApiPromise с одним деревом на любой блок и счётчиком чтений storage. */
function createService(
  tree: Tree,
  failIdentityNode = false,
  nodeIds: string[] = [],
) {
  const reads = { identityNode: 0, nodes: 0, nodeIdentity: 0, children: 0 };
  const cps = {
    identityNode: jest.fn((account: Uint8Array) => {
      reads.identityNode += 1;
      if (failIdentityNode) return Promise.reject(new Error('RPC down'));
      const entry = Object.entries(tree.identities).find(
        ([, value]) => hex(value) === hex(account),
      );
      return Promise.resolve(entry ? some({ toString: () => entry[0] }) : none);
    }),
    nodes: jest.fn((nodeId: string) => {
      reads.nodes += 1;
      if (!(nodeId in tree.parents)) return Promise.resolve(none);
      const parent = tree.parents[nodeId];
      return Promise.resolve(
        some({
          get: (field: string) =>
            field === 'parent'
              ? parent === null
                ? none
                : some({ toString: () => parent })
              : none,
        }),
      );
    }),
    nodeIdentity: jest.fn((nodeId: string) => {
      reads.nodeIdentity += 1;
      const account = tree.identities[nodeId];
      return Promise.resolve(account ? some({ toU8a: () => account }) : none);
    }),
    children: jest.fn((nodeId: string) => {
      reads.children += 1;
      return Promise.resolve(
        (tree.children[nodeId] ?? []).map((id) => ({ toString: () => id })),
      );
    }),
  };
  const api = {
    at: jest.fn().mockResolvedValue({ query: { cps } }),
    rpc: {
      chain: {
        getBlockHash: jest.fn((block: number) =>
          Promise.resolve({ toHex: () => `0x${block.toString(16)}` }),
        ),
      },
    },
  };
  const service = new CpsSensorIdentityService(
    {
      get: (k: string, fallback: unknown) =>
        k === 'cps.nodeIds' ? nodeIds : fallback,
    } as ConfigService,
    { getApi: () => Promise.resolve(api) } as unknown as RobonomicsService,
  );
  return { service, reads };
}

// Бандл 4 с identity владельца; датчики 12 и 13 — его дети, 15 — узел без identity.
const owner = key(1);
const urban = key(12);
const insight = key(13);
const tree: Tree = {
  parents: { '4': '3', '12': '4', '13': '4', '15': '4', '20': '9', '9': null },
  identities: { '4': owner, '12': urban, '13': insight, '20': key(20) },
  children: { '4': ['12', '13', '15'], '9': ['20'] },
};

describe('CpsSensorIdentityService', () => {
  it('владелец — identity родителя узла датчика, бандл — остальные дети родителя', async () => {
    const { service } = createService(tree);

    await expect(service.resolve(100, urban)).resolves.toEqual({
      owner: encodeAddress(owner, 32),
      ownerIsFallback: false,
      sensorNodeId: '12',
      parentNodeId: '4',
      bundle: [hex(insight)],
    });
  });

  it('родитель без identity: владелец — сам датчик', async () => {
    const { service } = createService(tree);

    await expect(service.resolve(100, key(20))).resolves.toMatchObject({
      owner: encodeAddress(key(20), 32),
      ownerIsFallback: true,
      parentNodeId: '9',
      bundle: [],
    });
  });

  it('ключ без узла в дереве отклоняется', async () => {
    const { service } = createService(tree);

    await expect(service.resolve(100, key(99))).resolves.toMatchObject({
      rejection: CpsSensorRejection.Unregistered,
      sensorNodeId: null,
      bundle: [],
    });
  });

  it('узел датчика вне поддеревьев CPS_NODE_IDS отклоняется, внутри — принимается', async () => {
    const { service } = createService(tree, false, ['3']);

    await expect(service.resolve(100, key(20))).resolves.toMatchObject({
      rejection: CpsSensorRejection.OutsideSubtree,
      sensorNodeId: '20',
    });
    const inside = await service.resolve(100, urban);
    expect(inside.rejection).toBeUndefined();
    expect(inside.owner).toBe(encodeAddress(owner, 32));
  });

  it('в одном блоке читает датчик один раз, бандл — один раз на всех соседей', async () => {
    const { service, reads } = createService(tree);

    for (let i = 0; i < 100; i += 1) {
      await service.resolve(100, urban);
      await service.resolve(100, insight);
    }

    expect(reads).toEqual({
      identityNode: 2,
      nodes: 2,
      nodeIdentity: 2 + 3,
      children: 1,
    });
  });

  it('кеш не переносит состояние между блоками', async () => {
    const { service, reads } = createService(tree);

    await service.resolve(100, urban);
    await service.resolve(101, urban);

    expect(reads.identityNode).toBe(2);
    expect(reads.children).toBe(2);
  });

  it('ошибку RPC пробрасывает и не кеширует', async () => {
    const { service, reads } = createService(tree, true);

    await expect(service.resolve(100, urban)).rejects.toThrow('RPC down');
    await expect(service.resolve(100, urban)).rejects.toThrow('RPC down');
    expect(reads.identityNode).toBe(2);
  });
});
