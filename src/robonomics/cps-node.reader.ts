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

interface CpsAccountCodec extends Codec {
  toU8a(isBare?: boolean): Uint8Array;
}

type CpsAccountOption = CpsCodecOption<CpsAccountCodec>;

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
  readonly identityNode?: CpsStorageEntry<CpsCodecOption<CpsNodeIdCodec>>;
  readonly nodeIdentity?: CpsStorageEntry<CpsAccountOption>;
}

interface CpsApiAt {
  readonly query: {
    readonly cps?: CpsStorageQuery;
  };
}

export interface CpsNodeState {
  /** Владелец ближайшего Scope узла партии; для V3 API, не для измерений. */
  readonly owner?: string;
  readonly meta: Uint8Array | null;
  readonly payload: Uint8Array | null;
}

export interface CpsSubtreeNodeState extends CpsNodeState {
  readonly nodeId: string;
}

/** Положение датчика в дереве CPS, найденное по его собственному ключу. */
export interface CpsSensorPlacement {
  /** NodeId, identity которого — ключ датчика; null, если ключ не привязан. */
  readonly sensorNodeId: string | null;
  /** Родитель узла датчика; null для непривязанного ключа или корня. */
  readonly parentNodeId: string | null;
  /** Identity родителя (32 байта); null, если у родителя её нет. */
  readonly ownerAccount: Uint8Array | null;
}

/**
 * Находит узел датчика по ключу и identity его родителя.
 * `identityNode` и `nodeIdentity` в паллете — строгая связка 1:1.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param sensorKey - 32-байтный Ed25519-ключ из подписанного конверта
 * @returns положение датчика; ошибки RPC пробрасываются
 */
export async function readCpsSensorPlacementAt(
  api: ApiPromise,
  blockHash: string,
  sensorKey: Uint8Array,
): Promise<CpsSensorPlacement> {
  const cpsQuery = await cpsQueryAt(api, blockHash);
  const { identityNode, nodeIdentity, nodes } = cpsQuery;
  if (!identityNode || !nodeIdentity || !nodes) {
    throw new Error(
      'CPS identity storage is unavailable at the requested block',
    );
  }

  const nodeOption = await identityNode(sensorKey);
  if (nodeOption.isNone) {
    return { sensorNodeId: null, parentNodeId: null, ownerAccount: null };
  }
  const sensorNodeId = normalizeCpsNodeId(nodeOption.unwrap().toString());

  const infoOption = await nodes(sensorNodeId);
  const parentOption = infoOption.isNone
    ? undefined
    : (infoOption.unwrap().get('parent') as CpsParentOption | undefined);
  if (!parentOption || parentOption.isNone) {
    return { sensorNodeId, parentNodeId: null, ownerAccount: null };
  }
  const parentNodeId = normalizeCpsNodeId(parentOption.unwrap().toString());

  const ownerOption = await nodeIdentity(parentNodeId);
  return {
    sensorNodeId,
    parentNodeId,
    ownerAccount: ownerOption.isNone ? null : ownerOption.unwrap().toU8a(true),
  };
}

/**
 * Читает identity всех детей узла — состав бандла.
 * Дети без identity — не датчики и пропускаются.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param parentNodeId - узел бандла
 * @returns NodeId детей и их 32-байтные ключи в порядке создания
 */
export async function readCpsBundleAt(
  api: ApiPromise,
  blockHash: string,
  parentNodeId: string,
): Promise<{ nodeId: string; account: Uint8Array }[]> {
  const cpsQuery = await cpsQueryAt(api, blockHash);
  const { children, nodeIdentity } = cpsQuery;
  if (!children || !nodeIdentity) {
    throw new Error(
      'CPS identity storage is unavailable at the requested block',
    );
  }

  const members: { nodeId: string; account: Uint8Array }[] = [];
  for (const childId of await children(parentNodeId)) {
    const nodeId = normalizeCpsNodeId(childId.toString());
    const identity = await nodeIdentity(nodeId);
    if (!identity.isNone) {
      members.push({ nodeId, account: identity.unwrap().toU8a(true) });
    }
  }
  return members;
}

/** Storage API паллета CPS в точном состоянии блока. */
async function cpsQueryAt(
  api: ApiPromise,
  blockHash: string,
): Promise<CpsStorageQuery> {
  const apiAt = (await api.at(blockHash)) as unknown as CpsApiAt;
  const cpsQuery = apiAt.query.cps;
  if (!cpsQuery) {
    throw new Error('CPS storage is unavailable at the requested block');
  }
  return cpsQuery;
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
 * Читает payload и meta из layout pallet 1.0 и владельца ближайшего Scope.
 * Узел вне Scope больше не ошибка: owner остаётся пустым. Владелец измерений
 * разрешается по каждому датчику отдельно (CpsSensorIdentityService).
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
  return {
    ...(owner ? { owner } : {}),
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
 * @returns SS58-адрес владельца Scope либо undefined
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
