import type { Message } from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';

const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000n;

/** Код ошибки метаданных проверенного сообщения Connectivity Protocol. */
export enum MessageMetadataValidationErrorCode {
  /** @deprecated Больше не выдаётся; значение осталось в сохранённых `error_code`. */
  NodeIdMismatch = 'NODE_ID_MISMATCH',
  InvalidTimestamp = 'INVALID_TIMESTAMP',
}

/** Результат проверки времени сообщения. */
export type MessageMetadataValidationResult =
  | {
      readonly valid: true;
      readonly timestamp: bigint;
      readonly recordedAt: Date;
    }
  | {
      readonly valid: false;
      readonly code: MessageMetadataValidationErrorCode;
    };

/**
 * Проверяет, что подписанное сообщение содержит положительный timestamp,
 * представимый типом Date и BSON Date. `Meta.node_id` устарел и не сверяется:
 * узел датчика находится по его ключу через `cps.identityNode`.
 * @param message - декодированное и криптографически проверенное сообщение
 * @returns нормализованные метаданные либо стабильный код ошибки
 */
export function validateMessageMetadata(
  message: Message,
): MessageMetadataValidationResult {
  const timestamp = message.metadata?.timestamp ?? 0n;
  if (timestamp <= 0n || timestamp > MAX_DATE_MILLISECONDS) {
    return {
      valid: false,
      code: MessageMetadataValidationErrorCode.InvalidTimestamp,
    };
  }

  return {
    valid: true,
    timestamp,
    recordedAt: new Date(Number(timestamp)),
  };
}
