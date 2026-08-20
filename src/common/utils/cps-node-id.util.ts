import { isIpfsCid } from './ipfs.util.js';

export const MAX_CPS_NODE_ID = (1n << 64n) - 1n;

/**
 * Преобразует числовой CPS NodeId в каноническую decimal string без потери u64.
 * Значения типа number намеренно не принимаются из-за риска потери точности.
 * @param value - bigint либо уже каноническая десятичная строка
 * @returns каноническое представление числового NodeId
 */
export function normalizeCpsNodeId(value: bigint | string): string {
  const normalized = typeof value === 'bigint' ? value.toString(10) : value;

  if (!/^(0|[1-9]\d*)$/.test(normalized)) {
    throw new RangeError('CPS node id must be a canonical unsigned integer');
  }

  const nodeId = BigInt(normalized);
  if (nodeId > MAX_CPS_NODE_ID) {
    throw new RangeError('CPS node id exceeds uint64 range');
  }

  return normalized;
}

/**
 * Создаёт стабильный ключ источника для идемпотентной записи CPS anchor.
 * @param nodeId - числовой CPS NodeId
 * @param cid - CID бинарного batch без вложенного пути
 * @returns ключ вида cps:<nodeId>:<cid>
 */
export function createCpsAnchorSourceKey(
  nodeId: bigint | string,
  cid: string,
): string {
  const normalizedNodeId = normalizeCpsNodeId(nodeId);
  if (!isIpfsCid(cid)) {
    throw new Error('CPS anchor CID is invalid');
  }

  return `cps:${normalizedNodeId}:${cid}`;
}
