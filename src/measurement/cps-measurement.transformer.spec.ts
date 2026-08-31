import { create } from '@bufbuild/protobuf';
import { ConfigService } from '@nestjs/config';
import {
  MessageSchema,
  MetaSchema,
  type Message,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import {
  UrbanSchema,
  UrbanSensorSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/device/v1/urban_pb.js';
import {
  BME280Schema,
  GPSSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/sensor/v1/sensor_pb.js';
import { TemperatureSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/sensor/v1/measurement_pb.js';
import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
  encodeAddress,
} from '@polkadot/util-crypto';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import {
  buildEnvelopeSigningBytes,
  Ed25519EnvelopeSignatureVerifier,
  type VerifiedSignedEnvelope,
} from './protocol/envelope-signature-verifier.js';

/** Создаёт брендированный тестовый конверт через настоящую Ed25519-проверку. */
async function createVerifiedEnvelope(): Promise<VerifiedSignedEnvelope> {
  await cryptoWaitReady();
  const pair = ed25519PairFromSeed(new Uint8Array(32).fill(4));
  const envelope = {
    envelopeIndex: 0,
    sensorId: pair.publicKey,
    timestamp: 1_787_594_400_999n,
    nonce: new Uint8Array(16).fill(8),
    message: new Uint8Array([1]),
    signature: new Uint8Array(),
  };
  const result = await new Ed25519EnvelopeSignatureVerifier().verify({
    ...envelope,
    signature: ed25519Sign(buildEnvelopeSigningBytes(envelope), pair),
  });
  if (!result.verified) throw new Error('Test envelope must be verified');
  return result.envelope;
}

/** Создаёт Urban-сообщение с опциональным GPS и температурой. */
function createUrbanMessage(owner: Uint8Array, withGeo: boolean): Message {
  const publicSensors = [
    create(UrbanSensorSchema, {
      sensor: {
        case: 'bme280',
        value: create(BME280Schema, {
          measurement: {
            case: 'temperature',
            value: create(TemperatureSchema, { celsius: 21.5 }),
          },
        }),
      },
    }),
  ];
  if (withGeo) {
    publicSensors.unshift(
      create(UrbanSensorSchema, {
        sensor: {
          case: 'gps',
          value: create(GPSSchema, { lat: 53.1959, lon: 50.1002, heightM: 80 }),
        },
      }),
    );
  }
  return create(MessageSchema, {
    metadata: create(MetaSchema, { owner }),
    payload: {
      case: 'urban',
      value: create(UrbanSchema, { public: publicSensors, private: [] }),
    },
  });
}

describe('CpsMeasurementTransformer', () => {
  const transformer = new CpsMeasurementTransformer({
    get: jest.fn().mockReturnValue(32),
  } as unknown as ConfigService);

  it('сохраняет доступный geo и публичные показатели Urban', async () => {
    const envelope = await createVerifiedEnvelope();
    const owner = new Uint8Array(32).fill(7);

    const result = transformer.transform(
      envelope,
      createUrbanMessage(owner, true),
      'cps:0:test',
    );

    expect(result.transformed).toBe(true);
    if (!result.transformed) return;
    expect(result.measurement).toMatchObject({
      sensor_id: Buffer.from(envelope.sensorId).toString('hex'),
      device_model: 'urban',
      geo: { lat: 53.1959, lng: 50.1002 },
      measurement: { temperature: 21.5 },
      owner: encodeAddress(owner, 32),
      timestamp: 1_787_594_400,
      source_type: 'cps',
      source_id: 'cps:0:test',
    });
  });

  it('сохраняет измерение без GPS и не добавляет geo', async () => {
    const envelope = await createVerifiedEnvelope();
    const result = transformer.transform(
      envelope,
      createUrbanMessage(new Uint8Array(32).fill(7), false),
      'cps:0:test',
    );

    expect(result.transformed).toBe(true);
    if (!result.transformed) return;
    expect(result.measurement).toMatchObject({
      measurement: { temperature: 21.5 },
      source_id: 'cps:0:test',
    });
    expect(result.measurement).not.toHaveProperty('geo');
  });
});
