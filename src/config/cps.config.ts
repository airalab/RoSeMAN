import { registerAs } from '@nestjs/config';
import { normalizeCpsNodeId } from '../common/utils/cps-node-id.util.js';
import { ProtocolBatchWireFormat } from '../measurement/protocol/signed-envelope-batch-payload.decoder.js';

const DEFAULT_BATCH_LIMIT_BYTES = 10 * 1024 * 1024;

/** Разбирает целое положительное значение конфигурации. */
function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
  name: string,
): number {
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new Error(`${name} must be a positive safe integer`);
  return value;
}

/** Разбирает формат сжатия CPS batch без эвристического определения. */
function parseWireFormat(raw: string | undefined): ProtocolBatchWireFormat {
  const value = raw ?? ProtocolBatchWireFormat.Xz;
  if (
    !Object.values(ProtocolBatchWireFormat).includes(
      value as ProtocolBatchWireFormat,
    )
  ) {
    throw new Error('CPS_BATCH_WIRE_FORMAT must be raw, xz or zlib');
  }
  return value as ProtocolBatchWireFormat;
}

/** Разбирает SS58-префикс адреса владельца. */
function parseSs58Prefix(raw: string | undefined): number {
  const value = raw === undefined ? 32 : Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 16_383) {
    throw new Error('CPS_OWNER_SS58_PREFIX must be an integer from 0 to 16383');
  }
  return value;
}

/**
 * Разбирает список числовых NodeId и приводит его к канонической форме uint64.
 * @param raw - список NodeId через запятую
 * @returns уникальные NodeId в виде десятичных строк
 */
export function parseCpsNodeIds(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return [
    ...new Set(raw.split(',').map((value) => normalizeCpsNodeId(value.trim()))),
  ];
}

/** Формирует проверенную конфигурацию snapshot и обработки CPS payload. */
export function createCpsConfig() {
  return {
    enabled: process.env.CPS_ENABLED === 'true',
    nodeIds: parseCpsNodeIds(process.env.CPS_NODE_IDS),
    batchWireFormat: parseWireFormat(process.env.CPS_BATCH_WIRE_FORMAT),
    pollInterval: parsePositiveInteger(
      process.env.CPS_POLL_INTERVAL,
      10_000,
      'CPS_POLL_INTERVAL',
    ),
    leaseDuration: parsePositiveInteger(
      process.env.CPS_LEASE_DURATION,
      60_000,
      'CPS_LEASE_DURATION',
    ),
    maxAnchorsPerPoll: parsePositiveInteger(
      process.env.CPS_MAX_ANCHORS_PER_POLL,
      10,
      'CPS_MAX_ANCHORS_PER_POLL',
    ),
    maxAttempts: parsePositiveInteger(
      process.env.CPS_MAX_ATTEMPTS,
      5,
      'CPS_MAX_ATTEMPTS',
    ),
    retryBaseDelay: parsePositiveInteger(
      process.env.CPS_RETRY_BASE_DELAY,
      15_000,
      'CPS_RETRY_BASE_DELAY',
    ),
    maxCompressedBytes: parsePositiveInteger(
      process.env.CPS_MAX_COMPRESSED_BYTES,
      DEFAULT_BATCH_LIMIT_BYTES,
      'CPS_MAX_COMPRESSED_BYTES',
    ),
    maxDecompressedBytes: parsePositiveInteger(
      process.env.CPS_MAX_DECOMPRESSED_BYTES,
      DEFAULT_BATCH_LIMIT_BYTES,
      'CPS_MAX_DECOMPRESSED_BYTES',
    ),
    maxXzMemoryBytes: parsePositiveInteger(
      process.env.CPS_MAX_XZ_MEMORY_BYTES,
      64 * 1024 * 1024,
      'CPS_MAX_XZ_MEMORY_BYTES',
    ),
    maxEnvelopeCount: parsePositiveInteger(
      process.env.CPS_MAX_ENVELOPE_COUNT,
      10_000,
      'CPS_MAX_ENVELOPE_COUNT',
    ),
    ownerSs58Prefix: parseSs58Prefix(process.env.CPS_OWNER_SS58_PREFIX),
  };
}

export default registerAs('cps', createCpsConfig);
