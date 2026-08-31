import { create, toBinary } from '@bufbuild/protobuf';
import {
  SignedEnvelopeBatchSchema,
  SignedEnvelopeSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
import { createCompressor } from 'lzma-native';
import { deflateSync } from 'node:zlib';
import {
  ProtocolBatchWireFormat,
  SignedEnvelopeBatchPayloadDecoder,
} from './signed-envelope-batch-payload.decoder.js';
import {
  ProtocolBatchDecodeError,
  ProtocolBatchDecodeErrorCode,
} from './signed-envelope.types.js';

/**
 * Создаёт wire bytes синтетического batch для тестов raw/zlib-декодера.
 * @returns protobuf-байты с одним структурно корректным конвертом
 */
function createBatchBytes(): Uint8Array {
  const envelope = create(SignedEnvelopeSchema, {
    sensorId: new Uint8Array(32).fill(1),
    timestamp: 1n,
    nonce: new Uint8Array(16).fill(2),
    message: new Uint8Array([8, 1]),
    signature: new Uint8Array(64).fill(3),
  });

  return toBinary(
    SignedEnvelopeBatchSchema,
    create(SignedEnvelopeBatchSchema, { batch: [envelope] }),
  );
}

/**
 * Упаковывает тестовый batch в тот же XZ/LZMA2-контейнер, что и connectivity.
 * @param bytes - исходные protobuf-байты
 * @returns XZ-байты после завершения потокового компрессора
 */
function compressXz(bytes: Uint8Array): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const compressor = createCompressor();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    compressor.on('data', (chunk: Buffer) => {
      chunks.push(new Uint8Array(chunk));
      totalBytes += chunk.byteLength;
    });
    compressor.once('error', reject);
    compressor.once('end', () => {
      const result = new Uint8Array(totalBytes);
      let offset = 0;
      for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(result);
    });
    compressor.end(
      Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  });
}

describe('SignedEnvelopeBatchPayloadDecoder', () => {
  it('декодирует raw protobuf без распаковки', async () => {
    const result = await new SignedEnvelopeBatchPayloadDecoder().decode(
      createBatchBytes(),
      ProtocolBatchWireFormat.Raw,
    );

    expect(result.envelopes).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('декодирует явно указанный zlib payload', async () => {
    const compressed = deflateSync(createBatchBytes());

    const result = await new SignedEnvelopeBatchPayloadDecoder().decode(
      compressed,
      ProtocolBatchWireFormat.Zlib,
    );

    expect(result.envelopes).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('декодирует XZ/LZMA2 payload connectivity', async () => {
    const compressed = await compressXz(createBatchBytes());

    const result = await new SignedEnvelopeBatchPayloadDecoder().decode(
      compressed,
      ProtocolBatchWireFormat.Xz,
    );

    expect(result.envelopes).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('останавливает XZ-распаковку при превышении выходного лимита', async () => {
    const compressed = await compressXz(createBatchBytes());

    await expect(
      new SignedEnvelopeBatchPayloadDecoder({
        maxDecompressedBytes: 32,
      }).decode(compressed, ProtocolBatchWireFormat.Xz),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.BatchTooLarge,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('отклоняет повреждённый zlib payload типизированной ошибкой', async () => {
    await expect(
      new SignedEnvelopeBatchPayloadDecoder().decode(
        new Uint8Array([1, 2, 3]),
        ProtocolBatchWireFormat.Zlib,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.DecompressionFailed,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('отклоняет сжатый вход сверх лимита до распаковки', async () => {
    await expect(
      new SignedEnvelopeBatchPayloadDecoder({ maxCompressedBytes: 2 }).decode(
        new Uint8Array(3),
        ProtocolBatchWireFormat.Zlib,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.CompressedBatchTooLarge,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('останавливает распаковку при превышении выходного лимита', async () => {
    const compressed = deflateSync(createBatchBytes());

    await expect(
      new SignedEnvelopeBatchPayloadDecoder({
        maxDecompressedBytes: 32,
      }).decode(compressed, ProtocolBatchWireFormat.Zlib),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.BatchTooLarge,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('fail-closed отклоняет неизвестный wire format', async () => {
    await expect(
      new SignedEnvelopeBatchPayloadDecoder().decode(
        createBatchBytes(),
        'gzip' as ProtocolBatchWireFormat,
      ),
    ).rejects.toEqual(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.UnsupportedWireFormat,
      }) as ProtocolBatchDecodeError,
    );
  });
});
