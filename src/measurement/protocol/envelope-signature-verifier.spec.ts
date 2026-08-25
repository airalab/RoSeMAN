import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
} from '@polkadot/util-crypto';
import {
  buildEnvelopeSigningBytes,
  Ed25519EnvelopeSignatureVerifier,
  SignatureVerificationFailureReason,
  timestampToLittleEndianBytes,
} from './envelope-signature-verifier.js';
import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

/**
 * Создаёт тестовый конверт, совместимый с alpha-генератором connectivity.
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
    timestamp: 0x01_02_03_04_05_06_07_08n,
    nonce: new Uint8Array(16).fill(8),
    message: new TextEncoder().encode('test-message'),
    signature: new Uint8Array(),
  };

  return {
    ...envelope,
    signature: ed25519Sign(buildEnvelopeSigningBytes(envelope), pair),
  };
}

describe('alpha signing contract', () => {
  it('кодирует uint64 timestamp как 8 байт little-endian', () => {
    expect(timestampToLittleEndianBytes(0x01_02_03_04_05_06_07_08n)).toEqual(
      new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]),
    );
  });

  it('собирает поля в нормативном порядке без protobuf re-encode', () => {
    const envelope = {
      sensorId: new Uint8Array([1, 2]),
      timestamp: 0x01_02_03_04_05_06_07_08n,
      nonce: new Uint8Array([3, 4]),
      message: new Uint8Array([5, 6]),
    };

    expect(buildEnvelopeSigningBytes(envelope)).toEqual(
      new Uint8Array([1, 2, 8, 7, 6, 5, 4, 3, 2, 1, 3, 4, 5, 6]),
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
      expect(result.envelope.timestamp).toBe(envelope.timestamp);
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
