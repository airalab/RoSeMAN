import { fromBinary } from '@bufbuild/protobuf';
import {
  SignedEnvelopeBatchSchema,
  type SignedEnvelope,
  type SignedEnvelopeBatch,
} from '@buf/airalab_sensors-social-proto.bufbuild_es/crypto/v1/envelope_pb.js';
import {
  EnvelopeValidationErrorCode,
  ProtocolBatchDecodeError,
  ProtocolBatchDecodeErrorCode,
  type EnvelopeValidationError,
  type SignedEnvelopeBatchDecodeResult,
  type UntrustedSignedEnvelope,
} from './signed-envelope.types.js';

export const DEFAULT_MAX_PROTOCOL_BATCH_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_ENVELOPES_PER_BATCH = 10_000;

const SENSOR_ID_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
const MIN_NONCE_LENGTH = 16;
const MAX_NONCE_LENGTH = 32;

/**
 * Ограничения безопасного структурного декодирования protobuf batch.
 */
export interface SignedEnvelopeBatchDecoderOptions {
  readonly maxBatchBytes?: number;
  readonly maxEnvelopeCount?: number;
}

/**
 * Декодирует batch до недоверенных конвертов, не разбирая вложенный Message.
 */
export class SignedEnvelopeBatchDecoder {
  private readonly maxBatchBytes: number;
  private readonly maxEnvelopeCount: number;

  /**
   * Создаёт декодер с защитными ограничениями размера и числа элементов.
   * @param options - необязательные ограничения обработки batch
   */
  constructor(options: SignedEnvelopeBatchDecoderOptions = {}) {
    this.maxBatchBytes =
      options.maxBatchBytes ?? DEFAULT_MAX_PROTOCOL_BATCH_BYTES;
    this.maxEnvelopeCount =
      options.maxEnvelopeCount ?? DEFAULT_MAX_ENVELOPES_PER_BATCH;

    if (this.maxBatchBytes <= 0 || this.maxEnvelopeCount <= 0) {
      throw new RangeError('Protocol batch limits must be positive');
    }
  }

  /**
   * Декодирует protobuf batch и валидирует структуру каждого конверта.
   * Вложенные сообщения остаются сырыми байтами до проверки подписи.
   * @param bytes - неизменённые байты `crypto.v1.SignedEnvelopeBatch`
   * @returns корректные по структуре недоверенные конверты и ошибки элементов
   */
  decode(bytes: Uint8Array): SignedEnvelopeBatchDecodeResult {
    this.assertInputSize(bytes);

    let batch: SignedEnvelopeBatch;

    try {
      batch = fromBinary(SignedEnvelopeBatchSchema, bytes);
    } catch (error) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.MalformedProtobuf,
        'Signed envelope batch contains malformed protobuf',
        { cause: error },
      );
    }

    if (batch.batch.length === 0) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.EmptyBatch,
        'Signed envelope batch is empty',
      );
    }

    if (batch.batch.length > this.maxEnvelopeCount) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.TooManyEnvelopes,
        `Signed envelope batch exceeds ${this.maxEnvelopeCount} envelopes`,
      );
    }

    const envelopes: UntrustedSignedEnvelope[] = [];
    const errors: EnvelopeValidationError[] = [];

    batch.batch.forEach((envelope, envelopeIndex) => {
      const envelopeErrors = this.validateEnvelope(envelope, envelopeIndex);
      errors.push(...envelopeErrors);

      if (envelopeErrors.length === 0) {
        envelopes.push(this.toUntrustedEnvelope(envelope, envelopeIndex));
      }
    });

    return { envelopes, errors };
  }

  /**
   * Проверяет размер входа до выделений памяти protobuf-декодером.
   * @param bytes - входные байты batch
   */
  private assertInputSize(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.EmptyInput,
        'Signed envelope batch input is empty',
      );
    }

    if (bytes.byteLength > this.maxBatchBytes) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.BatchTooLarge,
        `Signed envelope batch exceeds ${this.maxBatchBytes} bytes`,
      );
    }
  }

  /**
   * Проверяет поля конверта, не интерпретируя вложенное сообщение.
   * @param envelope - декодированный protobuf-конверт
   * @param envelopeIndex - позиция конверта в batch
   * @returns список найденных структурных ошибок
   */
  private validateEnvelope(
    envelope: SignedEnvelope,
    envelopeIndex: number,
  ): EnvelopeValidationError[] {
    const errors: EnvelopeValidationError[] = [];

    if (envelope.sensorId.byteLength !== SENSOR_ID_LENGTH) {
      errors.push({
        envelopeIndex,
        code: EnvelopeValidationErrorCode.InvalidSensorIdLength,
        message: `sensor_id must contain ${SENSOR_ID_LENGTH} bytes`,
      });
    }

    if (envelope.timestamp <= 0n) {
      errors.push({
        envelopeIndex,
        code: EnvelopeValidationErrorCode.InvalidTimestamp,
        message: 'timestamp must be a positive uint64 value',
      });
    }

    if (
      envelope.nonce.byteLength < MIN_NONCE_LENGTH ||
      envelope.nonce.byteLength > MAX_NONCE_LENGTH
    ) {
      errors.push({
        envelopeIndex,
        code: EnvelopeValidationErrorCode.InvalidNonceLength,
        message: `nonce must contain ${MIN_NONCE_LENGTH}-${MAX_NONCE_LENGTH} bytes`,
      });
    }

    if (envelope.message.byteLength === 0) {
      errors.push({
        envelopeIndex,
        code: EnvelopeValidationErrorCode.EmptyMessage,
        message: 'message must not be empty',
      });
    }

    if (envelope.signature.byteLength !== SIGNATURE_LENGTH) {
      errors.push({
        envelopeIndex,
        code: EnvelopeValidationErrorCode.InvalidSignatureLength,
        message: `signature must contain ${SIGNATURE_LENGTH} bytes`,
      });
    }

    return errors;
  }

  /**
   * Копирует поля структурно корректного конверта в недоверенную модель.
   * Копии защищают результат от мутаций protobuf-объекта после возврата.
   * @param envelope - структурно корректный protobuf-конверт
   * @param envelopeIndex - позиция конверта в batch
   * @returns конверт, который нельзя считать проверенным
   */
  private toUntrustedEnvelope(
    envelope: SignedEnvelope,
    envelopeIndex: number,
  ): UntrustedSignedEnvelope {
    return {
      envelopeIndex,
      sensorId: envelope.sensorId.slice(),
      timestamp: envelope.timestamp,
      nonce: envelope.nonce.slice(),
      message: envelope.message.slice(),
      signature: envelope.signature.slice(),
    };
  }
}
