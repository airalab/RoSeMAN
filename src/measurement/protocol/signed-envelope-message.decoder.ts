import { fromBinary } from '@bufbuild/protobuf';
import {
  MessageSchema,
  type Message,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import type { VerifiedSignedEnvelope } from './envelope-signature-verifier.js';

/**
 * Ошибка protobuf-декодирования вложенного доверенного сообщения.
 */
export class ProtocolMessageDecodeError extends Error {
  /**
   * Создаёт ошибку без включения исходного payload в сообщение.
   * @param envelopeIndex - позиция конверта в исходном batch
   * @param options - исходная ошибка protobuf runtime
   */
  constructor(
    readonly envelopeIndex: number,
    options?: ErrorOptions,
  ) {
    super('Verified envelope contains malformed core.v1.Message', options);
    this.name = ProtocolMessageDecodeError.name;
  }
}

/**
 * Декодирует core.v1.Message только из криптографически проверенного конверта.
 */
export class SignedEnvelopeMessageDecoder {
  /**
   * Декодирует вложенные protobuf-байты после прохождения границы доверия.
   * @param envelope - конверт с подтверждённой Ed25519-подписью
   * @returns декодированный корневой Message
   */
  decode(envelope: VerifiedSignedEnvelope): Message {
    try {
      return fromBinary(MessageSchema, envelope.message);
    } catch (error) {
      throw new ProtocolMessageDecodeError(envelope.envelopeIndex, {
        cause: error,
      });
    }
  }
}
