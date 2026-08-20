import { create, toBinary } from '@bufbuild/protobuf';
import {
  SignedEnvelopeBatchSchema,
  SignedEnvelopeSchema,
} from '@buf/airalab_sensors-social-proto.bufbuild_es/crypto/v1/envelope_pb.js';
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
