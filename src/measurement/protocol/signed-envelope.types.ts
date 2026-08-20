/**
 * Код структурной ошибки отдельного подписанного конверта.
 */
export enum EnvelopeValidationErrorCode {
  InvalidSensorIdLength = 'INVALID_SENSOR_ID_LENGTH',
  InvalidTimestamp = 'INVALID_TIMESTAMP',
  InvalidNonceLength = 'INVALID_NONCE_LENGTH',
  EmptyMessage = 'EMPTY_MESSAGE',
  InvalidSignatureLength = 'INVALID_SIGNATURE_LENGTH',
}

/**
 * Структурная ошибка отдельного конверта с его позицией в batch.
 */
export interface EnvelopeValidationError {
  readonly envelopeIndex: number;
  readonly code: EnvelopeValidationErrorCode;
  readonly message: string;
}

/**
 * Структурно корректный, но ещё не проверенный криптографически конверт.
 */
export interface UntrustedSignedEnvelope {
  readonly envelopeIndex: number;
  readonly sensorId: Uint8Array;
  readonly timestamp: bigint;
  readonly nonce: Uint8Array;
  readonly message: Uint8Array;
  readonly signature: Uint8Array;
}

/**
 * Результат структурного декодирования batch без повышения уровня доверия.
 */
export interface SignedEnvelopeBatchDecodeResult {
  readonly envelopes: readonly UntrustedSignedEnvelope[];
  readonly errors: readonly EnvelopeValidationError[];
}

/**
 * Код ошибки, относящейся ко всему protobuf batch.
 */
export enum ProtocolBatchDecodeErrorCode {
  EmptyInput = 'EMPTY_INPUT',
  BatchTooLarge = 'BATCH_TOO_LARGE',
  MalformedProtobuf = 'MALFORMED_PROTOBUF',
  EmptyBatch = 'EMPTY_BATCH',
  TooManyEnvelopes = 'TOO_MANY_ENVELOPES',
}

/**
 * Ошибка, из-за которой невозможно безопасно обработать весь protobuf batch.
 */
export class ProtocolBatchDecodeError extends Error {
  /**
   * Создаёт типизированную ошибку batch-декодирования.
   * @param code - стабильный машинно-читаемый код ошибки
   * @param message - диагностическое описание без содержимого payload
   * @param options - исходная ошибка декодера, если она доступна
   */
  constructor(
    readonly code: ProtocolBatchDecodeErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = ProtocolBatchDecodeError.name;
  }
}
