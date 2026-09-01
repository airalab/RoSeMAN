import { create } from '@bufbuild/protobuf';
import { ConfigService } from '@nestjs/config';
import {
  MessageSchema,
  MetaSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import {
  UrbanSchema,
  UrbanSensorSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/device/v1/urban_pb.js';
import { EncryptedSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/encrypted_pb.js';
import {
  BME280Schema,
  GPSSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/sensor/v1/sensor_pb.js';
import {
  HumiditySchema,
  TemperatureSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/sensor/v1/measurement_pb.js';
import { encodeAddress } from '@polkadot/util-crypto';
import {
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
} from '../common/constants/connectivity-storage.enum.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import { ConnectivityRecordMapper } from './connectivity-record.mapper.js';

describe('ConnectivityRecordMapper', () => {
  const mapper = new ConnectivityRecordMapper({
    get: jest.fn().mockReturnValue(32),
  } as unknown as ConfigService);
  const anchor = {
    source_key: 'cps:7:cid',
    node_id: '7',
    block: 100,
    cid: 'cid',
  } as CpsAnchorDocument;
  const envelope = {
    envelopeIndex: 2,
    sensorId: new Uint8Array(32).fill(1),
    timestamp: 1_787_594_400_999n,
    nonce: new Uint8Array(16).fill(2),
    message: new Uint8Array([3, 4, 5]),
    signature: new Uint8Array(64).fill(6),
  };

  it('сохраняет envelope bytes и timestamp без потери миллисекунд', () => {
    const record = mapper.createEnvelopeRecord(anchor, envelope);

    expect(record).toMatchObject({
      record_key: 'cps:7:cid:2',
      payload_key: 'cps:7:cid',
      envelope_index: 2,
      sensor_id: Buffer.from(envelope.sensorId).toString('hex'),
      sensor_id_raw: Buffer.from(envelope.sensorId),
      timestamp_ms: '1787594400999',
      recorded_at: new Date('2026-08-24T18:00:00.999Z'),
      nonce: Buffer.from(envelope.nonce),
      message_raw: Buffer.from(envelope.message),
      signature: Buffer.from(envelope.signature),
    });
  });

  it('сохраняет порядок public events, GPS height и exact private bytes', () => {
    const owner = new Uint8Array(32).fill(7);
    const privateSection = {
      version: 1,
      algorithm: 'xchacha20',
      from: new Uint8Array([8, 9]),
      nonce: new Uint8Array([10, 11, 12]),
      ciphertext: new Uint8Array([13, 14, 15]),
    };
    const message = create(MessageSchema, {
      metadata: create(MetaSchema, { owner }),
      payload: {
        case: 'urban',
        value: create(UrbanSchema, {
          public: [
            create(UrbanSensorSchema, {
              sensor: {
                case: 'bme280',
                value: create(BME280Schema, {
                  measurement: {
                    case: 'temperature',
                    value: create(TemperatureSchema, { celsius: 21.25 }),
                  },
                }),
              },
            }),
            create(UrbanSensorSchema, {
              sensor: {
                case: 'gps',
                value: create(GPSSchema, {
                  lat: 53.1,
                  lon: 50.2,
                  heightM: 81.5,
                }),
              },
            }),
            create(UrbanSensorSchema, {
              sensor: {
                case: 'bme280',
                value: create(BME280Schema, {
                  measurement: {
                    case: 'humidity',
                    value: create(HumiditySchema, { percent: 45.5 }),
                  },
                }),
              },
            }),
          ],
          private: [create(EncryptedSchema, privateSection)],
        }),
      },
    });

    const record = mapper.applyDecodedMessage(
      mapper.createEnvelopeRecord(anchor, envelope),
      message,
    );

    expect(record.signature_status).toBe(ConnectivitySignatureStatus.Valid);
    expect(record.decode_status).toBe(ConnectivityRecordDecodeStatus.Decoded);
    expect(record.payload_type).toBe(ConnectivityPayloadType.Urban);
    expect(record.owner_raw).toEqual(Buffer.from(owner));
    expect(record.owner).toBe(encodeAddress(owner, 32));
    expect(record.public_events).toEqual([
      {
        sensor_type: 'bme280',
        measurement_type: 'temperature',
        value: 21.25,
        unit: 'celsius',
      },
      {
        sensor_type: 'gps',
        measurement_type: 'location',
        unit: 'wgs84',
        lat: 53.1,
        lon: 50.2,
        height_m: 81.5,
      },
      {
        sensor_type: 'bme280',
        measurement_type: 'humidity',
        value: 45.5,
        unit: 'percent',
      },
    ]);
    expect(record.private_sections).toEqual([
      {
        version: 1,
        algorithm: 'xchacha20',
        from: Buffer.from(privateSection.from),
        nonce: Buffer.from(privateSection.nonce),
        ciphertext: Buffer.from(privateSection.ciphertext),
      },
    ]);
  });

  it('оставляет неизвестный payload как unsupported record', () => {
    const message = create(MessageSchema, {});

    const record = mapper.applyDecodedMessage(
      mapper.createEnvelopeRecord(anchor, envelope),
      message,
    );

    expect(record).toMatchObject({
      payload_type: ConnectivityPayloadType.Unknown,
      decode_status: ConnectivityRecordDecodeStatus.Unsupported,
      public_events: [],
      private_sections: [],
    });
  });
});
