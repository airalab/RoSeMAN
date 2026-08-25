import { create, toBinary } from '@bufbuild/protobuf';
import {
  MessageSchema,
  MetaSchema,
} from '@buf/airalab_sensors-social-proto.bufbuild_es/core/v1/message_pb.js';
import { UrbanSchema } from '@buf/airalab_sensors-social-proto.bufbuild_es/device/v1/urban_pb.js';
import {
  buildEnvelopeSigningBytes,
  Ed25519EnvelopeSignatureVerifier,
} from './envelope-signature-verifier.js';
import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
} from '@polkadot/util-crypto';
import {
  ProtocolMessageDecodeError,
  SignedEnvelopeMessageDecoder,
} from './signed-envelope-message.decoder.js';
import type { UntrustedSignedEnvelope } from './signed-envelope.types.js';

/**
 * Подписывает заданные байты Message для проверки границы доверия декодера.
 * @param message - сериализованный либо намеренно повреждённый Message
 * @returns структурно корректный конверт с валидной подписью
 */
async function signMessage(
  message: Uint8Array,
): Promise<UntrustedSignedEnvelope> {
  await cryptoWaitReady();
  const pair = ed25519PairFromSeed(new Uint8Array(32).fill(7));
  const envelope = {
    envelopeIndex: 4,
    sensorId: pair.publicKey,
    timestamp: 1_787_594_400_000n,
    nonce: new Uint8Array(16).fill(9),
    message,
    signature: new Uint8Array(),
  };

  return {
    ...envelope,
    signature: ed25519Sign(buildEnvelopeSigningBytes(envelope), pair),
  };
}

describe('SignedEnvelopeMessageDecoder', () => {
  it('декодирует Message только после успешной проверки подписи', async () => {
    const messageBytes = toBinary(
      MessageSchema,
      create(MessageSchema, {
        metadata: create(MetaSchema, { owner: new Uint8Array(32).fill(1) }),
        payload: {
          case: 'urban',
          value: create(UrbanSchema, { public: [], private: [] }),
        },
      }),
    );
    const untrustedEnvelope = await signMessage(messageBytes);
    const verification = await new Ed25519EnvelopeSignatureVerifier().verify(
      untrustedEnvelope,
    );

    expect(verification.verified).toBe(true);
    if (!verification.verified) {
      throw new Error('Expected envelope verification to succeed');
    }

    const message = new SignedEnvelopeMessageDecoder().decode(
      verification.envelope,
    );
    expect(message.metadata?.owner).toEqual(new Uint8Array(32).fill(1));
    expect(message.payload.case).toBe('urban');
  });

  it('возвращает типизированную ошибку для подписанного malformed Message', async () => {
    const untrustedEnvelope = await signMessage(new Uint8Array([10, 5, 1]));
    const verification = await new Ed25519EnvelopeSignatureVerifier().verify(
      untrustedEnvelope,
    );
    if (!verification.verified) {
      throw new Error('Expected envelope verification to succeed');
    }

    expect(() =>
      new SignedEnvelopeMessageDecoder().decode(verification.envelope),
    ).toThrow(
      expect.objectContaining({
        envelopeIndex: 4,
      }) as ProtocolMessageDecodeError,
    );
  });
});
