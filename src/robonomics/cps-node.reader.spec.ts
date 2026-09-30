import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';
import { readCpsNodeAt } from './cps-node.reader.js';

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

  it('отклоняет runtime без полного split-layout', async () => {
    const { api } = createApi({ nodes: jest.fn() });

    await expect(readCpsNodeAt(api, blockHash, '7')).rejects.toThrow(
      'Incomplete CPS 1.0 storage layout',
    );
  });
});
