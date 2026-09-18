import { cryptoWaitReady, ed25519Verify } from '@polkadot/util-crypto';
import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

const verifiedEnvelopeBrand: unique symbol = Symbol('verifiedEnvelope');

/**
 * Конверт, подпись которого успешно проверена по контракту v1-beta.2.
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
 * Собирает нормативные байты подписи Connectivity Protocol v1-beta.2.
 * @param envelope - структурно корректный недоверенный конверт
 * @returns sensor_id || nonce || message
 */
export function buildEnvelopeSigningBytes(
  envelope: Pick<UntrustedSignedEnvelope, 'sensorId' | 'nonce' | 'message'>,
): Uint8Array {
  const size =
    envelope.sensorId.byteLength +
    envelope.nonce.byteLength +
    envelope.message.byteLength;
  const result = new Uint8Array(size);
  let offset = 0;

  for (const part of [envelope.sensorId, envelope.nonce, envelope.message]) {
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
   * Проверяет Ed25519-подпись над нормативными байтами v1-beta.2.
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
