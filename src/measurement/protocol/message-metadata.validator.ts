import type { Message } from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';

const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000n;

/** Код ошибки метаданных проверенного сообщения Connectivity Protocol. */
export enum MessageMetadataValidationErrorCode {
  NodeIdMismatch = 'NODE_ID_MISMATCH',
  InvalidTimestamp = 'INVALID_TIMESTAMP',
}

/** Результат проверки CPS-идентичности и времени сообщения. */
export type MessageMetadataValidationResult =
  | {
      readonly valid: true;
      readonly nodeId: bigint;
      readonly timestamp: bigint;
      readonly recordedAt: Date;
    }
  | {
      readonly valid: false;
      readonly code: MessageMetadataValidationErrorCode;
    };

/**
 * Проверяет, что подписанное сообщение относится к CPS-узлу якоря и содержит
 * положительный timestamp, представимый типом Date и BSON Date.
 * @param message - декодированное и криптографически проверенное сообщение
 * @param expectedNodeId - канонический decimal NodeId CPS-якоря
 * @returns нормализованные метаданные либо стабильный код ошибки
 */
export function validateMessageMetadata(
  message: Message,
  expectedNodeId: string,
): MessageMetadataValidationResult {
  const nodeId = message.metadata?.nodeId ?? 0n;
  if (nodeId.toString(10) !== expectedNodeId) {
    return {
      valid: false,
      code: MessageMetadataValidationErrorCode.NodeIdMismatch,
    };
  }

  const timestamp = message.metadata?.timestamp ?? 0n;
  if (timestamp <= 0n || timestamp > MAX_DATE_MILLISECONDS) {
    return {
      valid: false,
      code: MessageMetadataValidationErrorCode.InvalidTimestamp,
    };
  }

  return {
    valid: true,
    nodeId,
    timestamp,
    recordedAt: new Date(Number(timestamp)),
  };
}
