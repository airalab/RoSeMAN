import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';
import {
  isCpsNodeInSubtreesAt,
  readCpsNodeAt,
  readCpsSubtreesAt,
} from './cps-node.reader.js';

describe('readCpsNodeAt', () => {
  const blockHash = { toString: () => '0x1234' } as Codec;
  const payloadBytes = new Uint8Array([1, 2, 3]);
  const metaBytes = new TextEncoder().encode('xz');

  /** Создаёт SCALE Option со значением для mock storage API. */
  function some<T>(value: T): { isNone: false; unwrap: () => T } {
    return { isNone: false, unwrap: () => value };
  }

  /** Создаёт пустой SCALE Option для mock storage API. */
  function none(): { isNone: true; unwrap: () => never } {
    return {
      isNone: true,
      unwrap: () => {
        throw new Error('Option is None');
      },
    };
  }

  /** Создаёт минимальный SCALE-подобный NodeId для mock storage API. */
  function nodeId(value: string): { toString: () => string } {
    return { toString: () => value };
  }

  /** Создаёт минимальный ApiPromise с runtime metadata указанного блока. */
  function createApi(cps: Record<string, jest.Mock>): {
    api: ApiPromise;
    at: jest.Mock;
  } {
    const at = jest.fn().mockResolvedValue({ query: { cps } });
    return {
      api: { at } as unknown as ApiPromise,
      at,
    };
  }

  it('читает отдельный Payload и owner Scope pallet 1.0', async () => {
    const scopeId = { toString: (): string => '3' };
    const payload = jest
      .fn()
      .mockResolvedValue(some({ toU8a: () => payloadBytes }));
    const meta = jest.fn().mockResolvedValue(some({ toU8a: () => metaBytes }));
    const nodes = jest.fn().mockResolvedValue(
      some({
        get: (key: string) => (key === 'scope' ? some(scopeId) : none()),
      }),
    );
    const scopes = jest.fn().mockResolvedValue(
      some({
        get: (key: string) =>
          key === 'owner'
            ? { toString: (): string => '5ScopeOwner' }
            : undefined,
      }),
    );
    const { api } = createApi({ payload, meta, nodes, scopes });

    await expect(readCpsNodeAt(api, blockHash, '7')).resolves.toEqual({
      owner: '5ScopeOwner',
      meta: metaBytes,
      payload: payloadBytes,
    });
    expect(nodes).toHaveBeenCalledWith('7');
    expect(scopes).toHaveBeenCalledWith(scopeId);
    expect(meta).toHaveBeenCalledWith('7');
  });

  it('наследует owner от ближайшего родительского Scope', async () => {
    const parentId = { toString: (): string => '5' };
    const scopeId = { toString: (): string => '1' };
    const payload = jest
      .fn()
      .mockResolvedValue(some({ toU8a: () => payloadBytes }));
    const nodes = jest
      .fn()
      .mockResolvedValueOnce(
        some({
          get: (key: string) => (key === 'parent' ? some(parentId) : none()),
        }),
      )
      .mockResolvedValueOnce(
        some({
          get: (key: string) => (key === 'scope' ? some(scopeId) : none()),
        }),
      );
    const scopes = jest.fn().mockResolvedValue(
      some({
        get: (key: string) =>
          key === 'owner'
            ? { toString: (): string => '5ParentScopeOwner' }
            : undefined,
      }),
    );
    const meta = jest.fn().mockResolvedValue(none());
    const { api } = createApi({ payload, meta, nodes, scopes });

    await expect(readCpsNodeAt(api, blockHash, '7')).resolves.toEqual({
      owner: '5ParentScopeOwner',
      meta: null,
      payload: payloadBytes,
    });
    expect(nodes).toHaveBeenNthCalledWith(1, '7');
    expect(nodes).toHaveBeenNthCalledWith(2, parentId);
    expect(scopes).toHaveBeenCalledWith(scopeId);
  });

  it('не разрешает Scope для отсутствующего payload', async () => {
    const payload = jest.fn().mockResolvedValue(none());
    const meta = jest.fn();
    const nodes = jest.fn();
    const scopes = jest.fn();
    const { api } = createApi({ payload, meta, nodes, scopes });

    await expect(readCpsNodeAt(api, blockHash, '7')).resolves.toBeNull();
    expect(nodes).not.toHaveBeenCalled();
    expect(scopes).not.toHaveBeenCalled();
    expect(meta).not.toHaveBeenCalled();
  });

  it('обходит все поддеревья, включая потомков узлов без payload', async () => {
    const scopeId = nodeId('1');
    const payload = jest
      .fn()
      .mockImplementation((id: string) =>
        ['1', '3'].includes(id)
          ? Promise.resolve(some({ toU8a: () => payloadBytes }))
          : Promise.resolve(none()),
      );
    const meta = jest.fn().mockResolvedValue(none());
    const nodes = jest.fn().mockResolvedValue(
      some({
        get: (key: string) => (key === 'scope' ? some(scopeId) : none()),
      }),
    );
    const scopes = jest.fn().mockResolvedValue(
      some({
        get: (key: string) =>
          key === 'owner' ? { toString: () => '5Owner' } : undefined,
      }),
    );
    const children = jest.fn().mockImplementation((id: string) => {
      const childIds: Record<string, { toString: () => string }[]> = {
        '0': [nodeId('1'), nodeId('2')],
        '1': [nodeId('3')],
        '2': [],
        '3': [nodeId('0')],
      };
      return Promise.resolve(childIds[id] ?? []);
    });
    const { api, at } = createApi({
      payload,
      meta,
      nodes,
      scopes,
      children,
    });

    await expect(
      readCpsSubtreesAt(api, blockHash, ['0', '1']),
    ).resolves.toEqual([
      {
        nodeId: '1',
        owner: '5Owner',
        meta: null,
        payload: payloadBytes,
      },
      {
        nodeId: '3',
        owner: '5Owner',
        meta: null,
        payload: payloadBytes,
      },
    ]);
    expect(at).toHaveBeenCalledTimes(1);
    expect(payload).toHaveBeenCalledTimes(4);
    expect(children).toHaveBeenCalledTimes(4);
  });

  it('определяет потомка настроенного корня по цепочке parent', async () => {
    const parents: Record<string, string | undefined> = {
      '42': '7',
      '7': '0',
      '0': undefined,
    };
    const nodes = jest.fn().mockImplementation((id: string) => {
      const parent = parents[id];
      return Promise.resolve(
        some({
          get: (key: string) =>
            key === 'parent' && parent ? some(nodeId(parent)) : none(),
        }),
      );
    });
    const { api } = createApi({ nodes });

    await expect(
      isCpsNodeInSubtreesAt(api, blockHash, 42n, new Set(['0'])),
    ).resolves.toBe(true);
    expect(nodes).toHaveBeenNthCalledWith(1, '42');
    expect(nodes).toHaveBeenNthCalledWith(2, '7');
  });

  it('отклоняет runtime без полного split-layout', async () => {
    const { api } = createApi({ nodes: jest.fn() });

    await expect(readCpsNodeAt(api, blockHash, '7')).rejects.toThrow(
      'Incomplete CPS 1.0 storage layout',
    );
  });
});
