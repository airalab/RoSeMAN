import { create, toBinary } from '@bufbuild/protobuf';
import { ConfigService } from '@nestjs/config';
import {
  MessageSchema,
  MetaSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import {
  SignedEnvelopeBatchSchema,
  SignedEnvelopeSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
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
} from '@polkadot/util-crypto';
import { CpsAnchorStatus } from '../common/constants/cps-anchor-status.enum.js';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import { SensorRepository } from '../database/repositories/sensor.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { CpsAnchorProcessorService } from './cps-anchor-processor.service.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { buildEnvelopeSigningBytes } from './protocol/envelope-signature-verifier.js';
import { ProtocolBatchWireFormat } from './protocol/signed-envelope-batch-payload.decoder.js';

/** Создаёт raw batch с одним валидно подписанным Urban-сообщением. */
async function createSignedBatch(withGeo: boolean): Promise<Uint8Array> {
  await cryptoWaitReady();
  const pair = ed25519PairFromSeed(new Uint8Array(32).fill(5));
  const message = toBinary(
    MessageSchema,
    create(MessageSchema, {
      metadata: create(MetaSchema, { owner: pair.publicKey }),
      payload: {
        case: 'urban',
        value: create(UrbanSchema, {
          public: [
            ...(withGeo
              ? [
                  create(UrbanSensorSchema, {
                    sensor: {
                      case: 'gps',
                      value: create(GPSSchema, { lat: 53.1, lon: 50.2 }),
                    },
                  }),
                ]
              : []),
            create(UrbanSensorSchema, {
              sensor: {
                case: 'bme280',
                value: create(BME280Schema, {
                  measurement: {
                    case: 'temperature',
                    value: create(TemperatureSchema, { celsius: 22.3 }),
                  },
                }),
              },
            }),
          ],
        }),
      },
    }),
  );
  const unsigned = {
    sensorId: pair.publicKey,
    timestamp: 1_787_594_400_000n,
    nonce: new Uint8Array(16).fill(2),
    message,
    signature: new Uint8Array(),
  };
  const envelope = create(SignedEnvelopeSchema, {
    ...unsigned,
    signature: ed25519Sign(buildEnvelopeSigningBytes(unsigned), pair),
  });
  return toBinary(
    SignedEnvelopeBatchSchema,
    create(SignedEnvelopeBatchSchema, { batch: [envelope] }),
  );
}

describe('CpsAnchorProcessorService', () => {
  it('проверяет raw batch и завершает anchor только после MongoDB-upsert', async () => {
    const values: Record<string, unknown> = {
      'cps.enabled': true,
      'cps.pollInterval': 10_000,
      'cps.leaseDuration': 60_000,
      'cps.maxAnchorsPerPoll': 10,
      'cps.maxAttempts': 5,
      'cps.retryBaseDelay': 1_000,
      'cps.batchWireFormat': ProtocolBatchWireFormat.Raw,
      'cps.ownerSs58Prefix': 32,
    };
    const config = {
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    } as unknown as ConfigService;
    const anchor = {
      source_key: 'cps:0:test',
      node_id: '0',
      block: 10,
      cid: 'QmTest',
      attempt_count: 1,
    } as CpsAnchorDocument;
    const claimNext = jest
      .fn()
      .mockResolvedValueOnce(anchor)
      .mockResolvedValueOnce(null);
    const updateStatus = jest.fn().mockResolvedValue(undefined);
    const upsertMany = jest
      .fn<Promise<void>, [Measurement[]]>()
      .mockResolvedValue(undefined);
    const bulkUpsert = jest.fn().mockResolvedValue(undefined);
    const processor = new CpsAnchorProcessorService(
      config,
      {
        fetchBytes: jest.fn().mockResolvedValue(await createSignedBatch(true)),
      } as unknown as IpfsFetcherService,
      { claimNext, updateStatus } as unknown as CpsAnchorRepository,
      { upsertMany } as unknown as MeasurementRepository,
      { bulkUpsert } as unknown as SensorRepository,
      new CpsMeasurementTransformer(config),
    );

    await expect(processor.runOnce()).resolves.toBe(1);
    expect(upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        source_id: anchor.source_key,
        geo: { lat: 53.1, lng: 50.2 },
        measurement: { temperature: 22.3 },
      }),
    ]);
    expect(bulkUpsert).toHaveBeenCalledTimes(1);
    expect(updateStatus).toHaveBeenCalledWith(
      anchor.source_key,
      CpsAnchorStatus.PROCESSED,
      { validEnvelopeCount: 1, invalidEnvelopeCount: 0 },
    );
    expect(upsertMany.mock.invocationCallOrder[0]).toBeLessThan(
      updateStatus.mock.invocationCallOrder[0],
    );
  });

  it('сохраняет measurement без geo и не обновляет sensors', async () => {
    const values: Record<string, unknown> = {
      'cps.enabled': true,
      'cps.pollInterval': 10_000,
      'cps.leaseDuration': 60_000,
      'cps.maxAnchorsPerPoll': 10,
      'cps.maxAttempts': 5,
      'cps.retryBaseDelay': 1_000,
      'cps.batchWireFormat': ProtocolBatchWireFormat.Raw,
      'cps.ownerSs58Prefix': 32,
    };
    const config = {
      get: jest.fn(
        (key: string, fallback?: unknown) => values[key] ?? fallback,
      ),
    } as unknown as ConfigService;
    const anchor = {
      source_key: 'cps:0:without-geo',
      node_id: '0',
      block: 11,
      cid: 'QmWithoutGeo',
      attempt_count: 1,
    } as CpsAnchorDocument;
    const claimNext = jest
      .fn()
      .mockResolvedValueOnce(anchor)
      .mockResolvedValueOnce(null);
    const updateStatus = jest.fn().mockResolvedValue(undefined);
    let savedMeasurements: Measurement[] = [];
    const upsertMany = jest.fn((docs: Measurement[]): Promise<void> => {
      savedMeasurements = docs;
      return Promise.resolve();
    });
    const bulkUpsert = jest.fn().mockResolvedValue(undefined);
    const processor = new CpsAnchorProcessorService(
      config,
      {
        fetchBytes: jest.fn().mockResolvedValue(await createSignedBatch(false)),
      } as unknown as IpfsFetcherService,
      { claimNext, updateStatus } as unknown as CpsAnchorRepository,
      { upsertMany } as unknown as MeasurementRepository,
      { bulkUpsert } as unknown as SensorRepository,
      new CpsMeasurementTransformer(config),
    );

    await expect(processor.runOnce()).resolves.toBe(1);
    expect(upsertMany).toHaveBeenCalledWith([
      expect.objectContaining({
        source_id: anchor.source_key,
        measurement: { temperature: 22.3 },
      }),
    ]);
    expect(savedMeasurements[0]).not.toHaveProperty('geo');
    expect(bulkUpsert).not.toHaveBeenCalled();
    expect(updateStatus).toHaveBeenCalledWith(
      anchor.source_key,
      CpsAnchorStatus.PROCESSED,
      { validEnvelopeCount: 1, invalidEnvelopeCount: 0 },
    );
  });
});
