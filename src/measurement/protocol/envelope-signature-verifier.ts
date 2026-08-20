import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

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
  | { readonly verified: true }
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
  verify(envelope: UntrustedSignedEnvelope): SignatureVerificationResult;
}

/**
 * Fail-closed реализация до утверждения сериализации timestamp для подписи.
 */
export class PendingEnvelopeSignatureVerifier implements EnvelopeSignatureVerifier {
  /**
   * Отклоняет любой конверт, пока интеграционный контракт подписи не подтверждён.
   * @param envelope - недоверенный конверт; содержимое намеренно не используется
   * @returns отрицательный результат с причиной блокировки
   */
  verify(envelope: UntrustedSignedEnvelope): SignatureVerificationResult {
    void envelope;
    return {
      verified: false,
      reason: SignatureVerificationFailureReason.ContractUnavailable,
    };
  }
}
