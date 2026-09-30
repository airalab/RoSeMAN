import { ProtocolBatchWireFormat } from '../common/constants/connectivity-storage.enum.js';
import { parseCpsCompressionMeta } from './cps-compression-meta.js';

describe('parseCpsCompressionMeta', () => {
  /** Преобразует тестовую строку meta в UTF-8 байты. */
  const encode = (value: string): Uint8Array => new TextEncoder().encode(value);

  it.each([undefined, null, new Uint8Array(), encode('   ')])(
    'выбирает Zstandard для отсутствующего meta',
    (meta) => {
      expect(parseCpsCompressionMeta(meta)).toBe(ProtocolBatchWireFormat.Zstd);
    },
  );

  it.each([
    ['zstd', ProtocolBatchWireFormat.Zstd],
    ['Zstandard', ProtocolBatchWireFormat.Zstd],
    ['xz', ProtocolBatchWireFormat.Xz],
    ['lzma2', ProtocolBatchWireFormat.Xz],
    ['lz4', ProtocolBatchWireFormat.Lz4],
    ['zlib', ProtocolBatchWireFormat.Zlib],
    ['raw', ProtocolBatchWireFormat.Raw],
    ['none', ProtocolBatchWireFormat.Raw],
  ])('разбирает текстовое meta %s', (meta, expected) => {
    expect(parseCpsCompressionMeta(encode(meta))).toBe(expected);
  });

  it.each([
    ['{"compressor":"lz4"}', ProtocolBatchWireFormat.Lz4],
    ['{"compression":"xz"}', ProtocolBatchWireFormat.Xz],
    ['{"wire_format":"zstd"}', ProtocolBatchWireFormat.Zstd],
    ['"zlib"', ProtocolBatchWireFormat.Zlib],
  ])('разбирает JSON meta %s', (meta, expected) => {
    expect(parseCpsCompressionMeta(encode(meta))).toBe(expected);
  });

  it.each([
    encode('brotli'),
    encode('{"compressor":"brotli"}'),
    encode('{invalid'),
    new Uint8Array([0xff]),
  ])('fail-closed обрабатывает неизвестное meta', (meta) => {
    expect(parseCpsCompressionMeta(meta)).toBe(
      ProtocolBatchWireFormat.Unsupported,
    );
  });
});
