import { cryptoWaitReady, ed25519Verify } from '@polkadot/util-crypto';
import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

const verifiedEnvelopeBrand: unique symbol = Symbol('verifiedEnvelope');

/**
 * Конверт, подпись которого успешно проверена по alpha-контракту connectivity.
 */
export interface VerifiedSignedEnvelope extends UntrustedSignedEnvelope {
  readonly [verifiedEnvelopeBrand]: true;
}

/**
 * Причина отказа криптографической проверки конверта.
 */
export enum SignatureVerificationFailureReason {
  ContractUnavailable = 'SIGNATURE_CONTRACT_UNAVAILABLE',
  InvalidSignature = 'INVALID_SIGNATURE',
}

/**
 * Явный результат проверки, не допускающий трактовки ошибки как успеха.
 */
export type SignatureVerificationResult =
  | {
      readonly verified: true;
      readonly envelope: VerifiedSignedEnvelope;
    }
  | {
      readonly verified: false;
      readonly reason: SignatureVerificationFailureReason;
    };

/**
 * Граница реализации проверки подписи конверта.
 */
export interface EnvelopeSignatureVerifier {
  /**
   * Проверяет подпись над полями конверта по утверждённому контракту.
   * @param envelope - структурно корректный, но недоверенный конверт
   * @returns результат криптографической проверки
   */
  verify(
    envelope: UntrustedSignedEnvelope,
  ): Promise<SignatureVerificationResult>;
}

/**
 * Fail-closed реализация для окружений без включённой проверки подписи.
 */
export class PendingEnvelopeSignatureVerifier implements EnvelopeSignatureVerifier {
  /**
   * Отклоняет любой конверт, не позволяя обойти криптографическую проверку.
   * @param envelope - недоверенный конверт; содержимое намеренно не используется
   * @returns отрицательный результат с причиной блокировки
   */
  verify(
    envelope: UntrustedSignedEnvelope,
  ): Promise<SignatureVerificationResult> {
    void envelope;
    return Promise.resolve({
      verified: false as const,
      reason: SignatureVerificationFailureReason.ContractUnavailable,
    });
  }
}

/**
 * Кодирует uint64 timestamp в нормативные 8 байт little-endian.
 * @param timestamp - timestamp конверта в миллисекундах
 * @returns восемь байт без преобразования через JavaScript number
 */
export function timestampToLittleEndianBytes(timestamp: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setBigUint64(0, timestamp, true);
  return bytes;
}

/**
 * Собирает нормативные байты подписи alpha-протокола connectivity.
 * @param envelope - структурно корректный недоверенный конверт
 * @returns sensor_id || timestamp_le || nonce || message
 */
export function buildEnvelopeSigningBytes(
  envelope: Pick<
    UntrustedSignedEnvelope,
    'sensorId' | 'timestamp' | 'nonce' | 'message'
  >,
): Uint8Array {
  const timestampBytes = timestampToLittleEndianBytes(envelope.timestamp);
  const size =
    envelope.sensorId.byteLength +
    timestampBytes.byteLength +
    envelope.nonce.byteLength +
    envelope.message.byteLength;
  const result = new Uint8Array(size);
  let offset = 0;

  for (const part of [
    envelope.sensorId,
    timestampBytes,
    envelope.nonce,
    envelope.message,
  ]) {
    result.set(part, offset);
    offset += part.byteLength;
  }

  return result;
}

/**
 * Проверяет Ed25519-подпись и повышает тип доверия только при успехе.
 */
export class Ed25519EnvelopeSignatureVerifier implements EnvelopeSignatureVerifier {
  /**
   * Проверяет Ed25519-подпись над нормативными байтами alpha-протокола.
   * @param envelope - структурно корректный недоверенный конверт
   * @returns проверенный конверт либо машинно-читаемая причина отказа
   */
  async verify(
    envelope: UntrustedSignedEnvelope,
  ): Promise<SignatureVerificationResult> {
    const cryptoReady = await cryptoWaitReady();
    if (!cryptoReady) {
      throw new Error('Ed25519 crypto backend is unavailable');
    }

    const verified = ed25519Verify(
      buildEnvelopeSigningBytes(envelope),
      envelope.signature,
      envelope.sensorId,
    );
    if (!verified) {
      return {
        verified: false,
        reason: SignatureVerificationFailureReason.InvalidSignature,
      };
    }

    return {
      verified: true,
      envelope: {
        ...envelope,
        [verifiedEnvelopeBrand]: true,
      },
    };
  }
}
