import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
} from '@polkadot/util-crypto';
import {
  buildEnvelopeSigningBytes,
  Ed25519EnvelopeSignatureVerifier,
  SignatureVerificationFailureReason,
} from './envelope-signature-verifier.js';
import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

/**
 * Создаёт тестовый конверт, совместимый с Connectivity Protocol v1-beta.2.
 * @returns недоверенный конверт с детерминированной Ed25519-подписью
 */
async function createSignedEnvelope(): Promise<UntrustedSignedEnvelope> {
  await cryptoWaitReady();
  const seed = Uint8Array.from(
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
  const pair = ed25519PairFromSeed(seed);
  const envelope = {
    envelopeIndex: 0,
    sensorId: pair.publicKey,
    nonce: new Uint8Array(16).fill(8),
    message: new TextEncoder().encode('test-message'),
    signature: new Uint8Array(),
  };

  return {
    ...envelope,
    signature: ed25519Sign(buildEnvelopeSigningBytes(envelope), pair),
  };
}

describe('v1-beta.2 signing contract', () => {
  it('собирает поля в нормативном порядке без protobuf re-encode', () => {
    const envelope = {
      sensorId: new Uint8Array([1, 2]),
      nonce: new Uint8Array([3, 4]),
      message: new Uint8Array([5, 6]),
    };

    expect(buildEnvelopeSigningBytes(envelope)).toEqual(
      new Uint8Array([1, 2, 3, 4, 5, 6]),
    );
  });
});

describe('Ed25519EnvelopeSignatureVerifier', () => {
  it('возвращает брендированный конверт для валидной подписи', async () => {
    const envelope = await createSignedEnvelope();

    const result = await new Ed25519EnvelopeSignatureVerifier().verify(
      envelope,
    );

    expect(result.verified).toBe(true);
    if (result.verified) {
      expect(result.envelope.message).toEqual(envelope.message);
    }
  });

  it('отклоняет конверт после изменения подписанного поля', async () => {
    const envelope = await createSignedEnvelope();
    const tamperedEnvelope = {
      ...envelope,
      message: new TextEncoder().encode('tampered'),
    };

    const result = await new Ed25519EnvelopeSignatureVerifier().verify(
      tamperedEnvelope,
    );

    expect(result).toEqual({
      verified: false,
      reason: SignatureVerificationFailureReason.InvalidSignature,
    });
  });
});
