import { ProtocolBatchWireFormat } from '../common/constants/connectivity-storage.enum.js';

const DEFAULT_CPS_WIRE_FORMAT = ProtocolBatchWireFormat.Zstd;

/**
 * Извлекает строковое имя компрессора из текстового или JSON meta.
 * @param value - разобранное JSON-значение
 * @returns имя компрессора либо undefined
 */
function extractCompressorName(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const meta = value as Record<string, unknown>;
  for (const key of [
    'compressor',
    'compression',
    'codec',
    'wireFormat',
    'wire_format',
  ]) {
    if (typeof meta[key] === 'string') return meta[key];
  }
  return undefined;
}

/**
 * Преобразует имя компрессора из CPS meta в поддерживаемый wire format.
 * Пустое meta соответствует Zstandard; неизвестное значение отклоняется
 * декодером через специальный формат `unsupported`.
 * @param meta - точные байты storage `cps.meta`
 * @returns формат распаковки transport payload
 */
export function parseCpsCompressionMeta(
  meta: Uint8Array | null | undefined,
): ProtocolBatchWireFormat {
  if (!meta || meta.byteLength === 0) return DEFAULT_CPS_WIRE_FORMAT;

  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(meta).trim();
  } catch {
    return ProtocolBatchWireFormat.Unsupported;
  }
  if (!text) return DEFAULT_CPS_WIRE_FORMAT;

  let compressor = text;
  if (text.startsWith('{') || text.startsWith('[') || text.startsWith('"')) {
    try {
      compressor = extractCompressorName(JSON.parse(text)) ?? '';
    } catch {
      return ProtocolBatchWireFormat.Unsupported;
    }
  }

  switch (compressor.trim().toLowerCase()) {
    case 'zstd':
    case 'zstandard':
      return ProtocolBatchWireFormat.Zstd;
    case 'xz':
    case 'lzma2':
      return ProtocolBatchWireFormat.Xz;
    case 'lz4':
      return ProtocolBatchWireFormat.Lz4;
    case 'zlib':
      return ProtocolBatchWireFormat.Zlib;
    case 'raw':
    case 'none':
    case 'uncompressed':
      return ProtocolBatchWireFormat.Raw;
    default:
      return ProtocolBatchWireFormat.Unsupported;
  }
}
