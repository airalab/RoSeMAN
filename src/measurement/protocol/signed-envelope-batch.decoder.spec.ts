import { create, toBinary } from '@bufbuild/protobuf';
import {
  SignedEnvelopeBatchSchema,
  SignedEnvelopeSchema,
  type SignedEnvelope,
} from '@buf/airalab_sensors-social-proto.bufbuild_es/crypto/v1/envelope_pb.js';
import { MessageSchema } from '@buf/airalab_sensors-social-proto.bufbuild_es/core/v1/message_pb.js';
import {
  PendingEnvelopeSignatureVerifier,
  SignatureVerificationFailureReason,
} from './envelope-signature-verifier.js';
import { SignedEnvelopeBatchDecoder } from './signed-envelope-batch.decoder.js';
import {
  EnvelopeValidationErrorCode,
  ProtocolBatchDecodeError,
  ProtocolBatchDecodeErrorCode,
} from './signed-envelope.types.js';

interface EnvelopeOverrides {
  readonly sensorId?: Uint8Array;
  readonly timestamp?: bigint;
  readonly nonce?: Uint8Array;
  readonly message?: Uint8Array;
  readonly signature?: Uint8Array;
}

/**
 * Создаёт синтетический структурно корректный конверт для unit-тестов.
 * Его подпись не является криптографически валидной.
 * @param overrides - поля, которые нужно заменить в тестовом конверте
 * @returns protobuf-сообщение SignedEnvelope
 */
function createEnvelope(overrides: EnvelopeOverrides = {}): SignedEnvelope {
  return create(SignedEnvelopeSchema, {
    sensorId: new Uint8Array(32).fill(1),
    timestamp: 9_007_199_254_740_993n,
    nonce: new Uint8Array(16).fill(2),
    message: new Uint8Array([8, 1]),
    signature: new Uint8Array(64).fill(3),
    ...overrides,
  });
}

/**
 * Сериализует список тестовых конвертов в wire format batch.
 * @param envelopes - protobuf-конверты для включения в batch
 * @returns сериализованные байты SignedEnvelopeBatch
 */
function createBatchBytes(envelopes: SignedEnvelope[]): Uint8Array {
  return toBinary(
    SignedEnvelopeBatchSchema,
    create(SignedEnvelopeBatchSchema, { batch: envelopes }),
  );
}

describe('SignedEnvelopeBatchDecoder', () => {
  const decoder = new SignedEnvelopeBatchDecoder();

  it('импортирует схемы SDK и сохраняет точность uint64 timestamp', () => {
    const result = decoder.decode(createBatchBytes([createEnvelope()]));

    expect(SignedEnvelopeBatchSchema.typeName).toBe(
      'crypto.v1.SignedEnvelopeBatch',
    );
    expect(MessageSchema.typeName).toBe('core.v1.Message');
    expect(result.errors).toEqual([]);
    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].timestamp).toBe(9_007_199_254_740_993n);
  });

  it('возвращает типизированные ошибки элемента и продолжает batch', () => {
    const invalidEnvelope = createEnvelope({
      sensorId: new Uint8Array(31),
      timestamp: 0n,
      nonce: new Uint8Array(15),
      message: new Uint8Array(),
      signature: new Uint8Array(63),
    });

    const result = decoder.decode(
      createBatchBytes([invalidEnvelope, createEnvelope()]),
    );

    expect(result.envelopes).toHaveLength(1);
    expect(result.envelopes[0].envelopeIndex).toBe(1);
    expect(result.errors.map(({ code }) => code)).toEqual([
      EnvelopeValidationErrorCode.InvalidSensorIdLength,
      EnvelopeValidationErrorCode.InvalidTimestamp,
      EnvelopeValidationErrorCode.InvalidNonceLength,
      EnvelopeValidationErrorCode.EmptyMessage,
      EnvelopeValidationErrorCode.InvalidSignatureLength,
    ]);
    expect(
      result.errors.every(({ envelopeIndex }) => envelopeIndex === 0),
    ).toBe(true);
  });

  it('отклоняет повреждённый protobuf типизированной ошибкой', () => {
    expect(() => decoder.decode(new Uint8Array([10, 5, 1]))).toThrow(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.MalformedProtobuf,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('проверяет лимит байтов до protobuf-декодирования', () => {
    const limitedDecoder = new SignedEnvelopeBatchDecoder({ maxBatchBytes: 2 });

    expect(() => limitedDecoder.decode(new Uint8Array(3))).toThrow(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.BatchTooLarge,
      }) as ProtocolBatchDecodeError,
    );
  });

  it('проверяет максимальное число конвертов', () => {
    const limitedDecoder = new SignedEnvelopeBatchDecoder({
      maxEnvelopeCount: 1,
    });

    expect(() =>
      limitedDecoder.decode(
        createBatchBytes([createEnvelope(), createEnvelope()]),
      ),
    ).toThrow(
      expect.objectContaining({
        code: ProtocolBatchDecodeErrorCode.TooManyEnvelopes,
      }) as ProtocolBatchDecodeError,
    );
  });
});

describe('PendingEnvelopeSignatureVerifier', () => {
  it('всегда отклоняет конверт при принудительном fail-closed режиме', async () => {
    const [envelope] = new SignedEnvelopeBatchDecoder().decode(
      createBatchBytes([createEnvelope()]),
    ).envelopes;

    const result = await new PendingEnvelopeSignatureVerifier().verify(
      envelope,
    );

    expect(result).toEqual({
      verified: false,
      reason: SignatureVerificationFailureReason.ContractUnavailable,
    });
  });
});
