import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';

const MAX_CPS_SCOPE_RESOLUTION_NODES = 32;

interface CpsCodecOption<T extends Codec> extends Codec {
  readonly isNone: boolean;
  unwrap(): T;
}

interface CpsPayloadCodec extends Codec {
  toU8a(isBare?: boolean): Uint8Array;
}

type CpsPayloadOption = CpsCodecOption<CpsPayloadCodec>;

interface CpsNodeCodec extends Codec {
  get(key: string): Codec | undefined;
}

type CpsNodeOption = CpsCodecOption<CpsNodeCodec>;

type CpsNodeIdCodec = Codec;

type CpsParentOption = CpsCodecOption<CpsNodeIdCodec>;

interface CpsScopeInfoCodec extends Codec {
  get(key: string): Codec | undefined;
}

type CpsScopeInfoOption = CpsCodecOption<CpsScopeInfoCodec>;

interface CpsStorageEntry<T extends Codec> {
  (nodeId: unknown): Promise<T>;
}

interface CpsStorageQuery {
  readonly nodes?: CpsStorageEntry<CpsNodeOption>;
  readonly payload?: CpsStorageEntry<CpsPayloadOption>;
  readonly scopes?: CpsStorageEntry<CpsScopeInfoOption>;
}

interface CpsApiAt {
  readonly query: {
    readonly cps?: CpsStorageQuery;
  };
}

export interface CpsNodeState {
  readonly owner?: string;
  readonly payload: Uint8Array | null;
}

/**
 * Читает CPS node из layout pallet 1.0 в точно указанном состоянии чейна.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param nodeId - числовой NodeId или его SCALE-кодек
 * @returns текущее состояние node либо null, если node отсутствует
 */
export async function readCpsNodeAt(
  api: ApiPromise,
  blockHash: Codec,
  nodeId: unknown,
): Promise<CpsNodeState | null> {
  const apiAt = (await api.at(blockHash.toString())) as unknown as CpsApiAt;
  const cpsQuery = apiAt.query.cps;
  if (!cpsQuery) {
    throw new Error('CPS storage is unavailable at the requested block');
  }

  return readSplitCpsNode(cpsQuery, nodeId);
}

/**
 * Читает payload из layout pallet 1.0 и разрешает владельца ближайшего Scope.
 * @param cpsQuery - storage API pallet CPS для конкретного блока
 * @param nodeId - идентификатор CPS node
 * @returns состояние node либо null при отсутствии payload
 */
async function readSplitCpsNode(
  cpsQuery: CpsStorageQuery,
  nodeId: unknown,
): Promise<CpsNodeState | null> {
  const payload = cpsQuery.payload;
  const nodes = cpsQuery.nodes;
  const scopes = cpsQuery.scopes;
  if (!payload || !nodes || !scopes) {
    throw new Error('Incomplete CPS 1.0 storage layout');
  }

  const payloadOption = await payload(nodeId);
  if (payloadOption.isNone) return null;

  const owner = await resolveScopeOwner(nodes, scopes, nodeId);
  if (!owner) {
    throw new Error('CPS scope owner not found');
  }

  return {
    owner,
    payload: payloadOption.unwrap().toU8a(true),
  };
}

/**
 * Ищет owner ближайшего Scope в консолидированном layout pallet 1.0.
 * @param nodes - storage entry `cps.nodes` с `NodeInfo { parent, scope }`
 * @param scopes - storage entry `cps.scopes` с `ScopeInfo { owner, ... }`
 * @param nodeId - начальный идентификатор CPS node
 * @returns SS58-адрес владельца Scope либо undefined для неконсистентного state
 */
async function resolveScopeOwner(
  nodes: CpsStorageEntry<CpsNodeOption>,
  scopes: CpsStorageEntry<CpsScopeInfoOption>,
  nodeId: unknown,
): Promise<string | undefined> {
  let currentNodeId = nodeId;

  for (let depth = 0; depth < MAX_CPS_SCOPE_RESOLUTION_NODES; depth += 1) {
    const nodeOption = await nodes(currentNodeId);
    if (nodeOption.isNone) return undefined;

    const node = nodeOption.unwrap();
    const scopeOption = node.get('scope') as CpsParentOption | undefined;
    if (scopeOption && !scopeOption.isNone) {
      const scopeInfoOption = await scopes(scopeOption.unwrap());
      if (scopeInfoOption.isNone) return undefined;
      return scopeInfoOption.unwrap().get('owner')?.toString();
    }

    const parentOption = node.get('parent') as CpsParentOption | undefined;
    if (!parentOption || parentOption.isNone) return undefined;
    currentNodeId = parentOption.unwrap();
  }

  throw new Error('CPS scope resolution depth exceeded');
}
