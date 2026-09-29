import { createHash } from 'node:crypto';
import { MAX_CPS_CHAIN_PAYLOAD_BYTES } from '../constants/cps-payload.constants.js';
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

/**
 * Создаёт стабильный ключ источника для payload, сохранённого прямо в чейне.
 * Хеш сохраняет content-addressed семантику прежнего CID-ключа и не раскрывает
 * бинарное содержимое payload в индексах и логах.
 * @param nodeId - числовой CPS NodeId
 * @param payload - точные байты chain payload
 * @returns ключ вида cps:<nodeId>:chain:<sha256>
 */
export function createCpsChainPayloadSourceKey(
  nodeId: bigint | string,
  payload: Uint8Array,
): string {
  if (payload.byteLength === 0) {
    throw new RangeError('CPS chain payload must not be empty');
  }
  if (payload.byteLength > MAX_CPS_CHAIN_PAYLOAD_BYTES) {
    throw new RangeError(
      `CPS chain payload exceeds ${MAX_CPS_CHAIN_PAYLOAD_BYTES} bytes`,
    );
  }

  const normalizedNodeId = normalizeCpsNodeId(nodeId);
  const digest = createHash('sha256').update(payload).digest('hex');
  return `cps:${normalizedNodeId}:chain:${digest}`;
}
