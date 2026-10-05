import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';
import { normalizeCpsNodeId } from '../common/utils/cps-node-id.util.js';

const MAX_CPS_TREE_DEPTH = 32;

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

interface CpsChildrenCodec extends Codec, Iterable<CpsNodeIdCodec> {}

interface CpsStorageEntry<T extends Codec> {
  (nodeId: unknown): Promise<T>;
}

interface CpsStorageQuery {
  readonly nodes?: CpsStorageEntry<CpsNodeOption>;
  readonly meta?: CpsStorageEntry<CpsPayloadOption>;
  readonly payload?: CpsStorageEntry<CpsPayloadOption>;
  readonly scopes?: CpsStorageEntry<CpsScopeInfoOption>;
  readonly children?: CpsStorageEntry<CpsChildrenCodec>;
}

interface CpsApiAt {
  readonly query: {
    readonly cps?: CpsStorageQuery;
  };
}

export interface CpsNodeState {
  readonly owner?: string;
  readonly meta: Uint8Array | null;
  readonly payload: Uint8Array | null;
}

export interface CpsSubtreeNodeState extends CpsNodeState {
  readonly nodeId: string;
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
 * Рекурсивно читает payload корневых CPS-узлов и всех их потомков.
 * Пересекающиеся поддеревья и ошибочные циклические ссылки обрабатываются один раз.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param rootNodeIds - корни CPS-поддеревьев
 * @returns состояния всех узлов с установленным payload в порядке обхода в ширину
 */
export async function readCpsSubtreesAt(
  api: ApiPromise,
  blockHash: Codec,
  rootNodeIds: readonly (bigint | string)[],
): Promise<CpsSubtreeNodeState[]> {
  const apiAt = (await api.at(blockHash.toString())) as unknown as CpsApiAt;
  const cpsQuery = apiAt.query.cps;
  if (!cpsQuery) {
    throw new Error('CPS storage is unavailable at the requested block');
  }

  const children = cpsQuery.children;
  if (!children) {
    throw new Error('Incomplete CPS 1.0 storage layout: children unavailable');
  }

  const queue = rootNodeIds.map((nodeId) => normalizeCpsNodeId(nodeId));
  const visited = new Set<string>();
  const result: CpsSubtreeNodeState[] = [];

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const nodeId = queue[cursor];
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    const node = await readSplitCpsNode(cpsQuery, nodeId);
    if (node) result.push({ nodeId, ...node });

    const childIds = await children(nodeId);
    for (const childId of childIds) {
      const normalizedChildId = normalizeCpsNodeId(childId.toString());
      if (!visited.has(normalizedChildId)) queue.push(normalizedChildId);
    }
  }

  return result;
}

/**
 * Проверяет, принадлежит ли CPS-узел одному из настроенных корневых поддеревьев.
 * Пустой набор корней сохраняет режим без realtime-ограничения.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param nodeId - проверяемый CPS NodeId
 * @param rootNodeIds - разрешённые корни поддеревьев
 * @returns `true`, если узел равен корню или является его потомком
 */
export async function isCpsNodeInSubtreesAt(
  api: ApiPromise,
  blockHash: Codec,
  nodeId: bigint | string,
  rootNodeIds: ReadonlySet<string>,
): Promise<boolean> {
  const normalizedNodeId = normalizeCpsNodeId(nodeId);
  if (rootNodeIds.size === 0 || rootNodeIds.has(normalizedNodeId)) return true;

  const apiAt = (await api.at(blockHash.toString())) as unknown as CpsApiAt;
  const cpsQuery = apiAt.query.cps;
  if (!cpsQuery) {
    throw new Error('CPS storage is unavailable at the requested block');
  }
  const nodes = cpsQuery.nodes;
  if (!nodes) {
    throw new Error('Incomplete CPS 1.0 storage layout: nodes unavailable');
  }

  let currentNodeId = normalizedNodeId;
  for (let depth = 0; depth <= MAX_CPS_TREE_DEPTH; depth += 1) {
    const nodeOption = await nodes(currentNodeId);
    if (nodeOption.isNone) return false;

    const parentOption = nodeOption.unwrap().get('parent') as
      | CpsParentOption
      | undefined;
    if (!parentOption || parentOption.isNone) return false;

    currentNodeId = normalizeCpsNodeId(parentOption.unwrap().toString());
    if (rootNodeIds.has(currentNodeId)) return true;
  }

  throw new Error('CPS ancestry depth exceeded');
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
  const meta = cpsQuery.meta;
  const nodes = cpsQuery.nodes;
  const scopes = cpsQuery.scopes;
  if (!payload || !meta || !nodes || !scopes) {
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
    meta: await readSplitCpsMeta(meta, nodeId),
    payload: payloadOption.unwrap().toU8a(true),
  };
}

/**
 * Читает необязательное meta из отдельного storage pallet 1.0.
 * @param meta - storage entry `cps.meta`
 * @param nodeId - идентификатор CPS node
 * @returns точные meta-байты либо null
 */
async function readSplitCpsMeta(
  meta: CpsStorageEntry<CpsPayloadOption>,
  nodeId: unknown,
): Promise<Uint8Array | null> {
  const metaOption = await meta(nodeId);
  return metaOption.isNone ? null : metaOption.unwrap().toU8a(true);
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

  for (let depth = 0; depth <= MAX_CPS_TREE_DEPTH; depth += 1) {
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
