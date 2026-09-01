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
import { ConnectivityPayloadRepository } from '../database/repositories/connectivity-payload.repository.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from '../database/repositories/connectivity-record.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import { SensorRepository } from '../database/repositories/sensor.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { ConnectivityRecordMapper } from './connectivity-record.mapper.js';
import { CpsAnchorProcessorService } from './cps-anchor-processor.service.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { buildEnvelopeSigningBytes } from './protocol/envelope-signature-verifier.js';
import { ProtocolBatchWireFormat } from './protocol/signed-envelope-batch-payload.decoder.js';

type FailurePoint =
  | 'fetch'
  | 'raw-payload'
  | 'record-pending'
  | 'record-decoded'
  | 'measurement'
  | 'sensor'
  | 'record-projected'
  | 'payload-status'
  | 'anchor-status';

interface RetryHarness {
  readonly processor: CpsAnchorProcessorService;
  readonly anchor: CpsAnchorDocument;
  readonly fetchBytes: jest.Mock;
  readonly upsertFetched: jest.Mock;
  readonly updateDecodeStatus: jest.Mock;
  readonly upsertRecord: jest.Mock;
  readonly upsertMany: jest.Mock;
  readonly bulkUpsert: jest.Mock;
  readonly updateStatus: jest.Mock;
}

/** Создаёт raw batch с GPS и одним scalar measurement для проверки всех writes. */
async function createSignedBatch(): Promise<Uint8Array> {
  await cryptoWaitReady();
  const pair = ed25519PairFromSeed(new Uint8Array(32).fill(9));
  const message = toBinary(
    MessageSchema,
    create(MessageSchema, {
      metadata: create(MetaSchema, { owner: pair.publicKey }),
      payload: {
        case: 'urban',
        value: create(UrbanSchema, {
          public: [
            create(UrbanSensorSchema, {
              sensor: {
                case: 'gps',
                value: create(GPSSchema, { lat: 53.1, lon: 50.2 }),
              },
            }),
            create(UrbanSensorSchema, {
              sensor: {
                case: 'bme280',
                value: create(BME280Schema, {
                  measurement: {
                    case: 'temperature',
                    value: create(TemperatureSchema, { celsius: 20.5 }),
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
    timestamp: 1_787_594_400_555n,
    nonce: new Uint8Array(16).fill(4),
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

/**
 * Создаёт processor, который один раз падает на выбранной границе persistence.
 * @param failurePoint - операция, отклоняющая первый соответствующий вызов
 * @returns processor и mocks для проверки повторной обработки
 */
async function createRetryHarness(
  failurePoint: FailurePoint,
): Promise<RetryHarness> {
  const batchBytes = await createSignedBatch();
  const values: Record<string, unknown> = {
    'cps.enabled': true,
    'cps.canonicalStorageEnabled': true,
    'cps.rawPayloadStorageEnabled': true,
    'cps.pollInterval': 10_000,
    'cps.leaseDuration': 60_000,
    'cps.maxAnchorsPerPoll': 10,
    'cps.maxAttempts': 5,
    'cps.retryBaseDelay': 1,
    'cps.batchWireFormat': ProtocolBatchWireFormat.Raw,
    'cps.ownerSs58Prefix': 32,
  };
  const config = {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
  const anchor = {
    source_key: 'cps:9:retry',
    node_id: '9',
    block: 99,
    cid: 'QmRetry',
    attempt_count: 1,
  } as CpsAnchorDocument;
  const retryAnchor = { ...anchor, attempt_count: 2 } as CpsAnchorDocument;
  const claimNext = jest
    .fn()
    .mockResolvedValueOnce(anchor)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce(retryAnchor)
    .mockResolvedValueOnce(null);
  const transientError = new Error(`Failure at ${failurePoint}`);
  const fetchBytes = jest.fn().mockResolvedValue(batchBytes);
  const upsertFetched = jest.fn().mockResolvedValue(undefined);
  const updateDecodeStatus = jest.fn().mockResolvedValue(undefined);
  const upsertRecord = jest.fn().mockResolvedValue(undefined);
  const upsertMany = jest.fn().mockResolvedValue(undefined);
  const bulkUpsert = jest.fn().mockResolvedValue(undefined);
  const updateStatus = jest.fn().mockResolvedValue(undefined);

  if (failurePoint === 'fetch') {
    fetchBytes.mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'raw-payload') {
    upsertFetched.mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'record-pending') {
    upsertRecord.mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'record-decoded') {
    upsertRecord
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'measurement') {
    upsertMany.mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'sensor') {
    bulkUpsert.mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'record-projected') {
    upsertRecord
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(transientError);
  } else if (failurePoint === 'payload-status') {
    updateDecodeStatus.mockRejectedValueOnce(transientError);
  } else {
    let finalStatusFailed = false;
    updateStatus.mockImplementation(
      (_sourceKey: string, status: CpsAnchorStatus): Promise<void> => {
        if (status === CpsAnchorStatus.PROCESSED && !finalStatusFailed) {
          finalStatusFailed = true;
          return Promise.reject(transientError);
        }
        return Promise.resolve();
      },
    );
  }

  const processor = new CpsAnchorProcessorService(
    config,
    { fetchBytes } as unknown as IpfsFetcherService,
    { claimNext, updateStatus } as unknown as CpsAnchorRepository,
    {
      upsertFetched,
      updateDecodeStatus,
    } as unknown as ConnectivityPayloadRepository,
    { upsertRecord } as unknown as ConnectivityRecordRepository,
    { upsertMany } as unknown as MeasurementRepository,
    { bulkUpsert } as unknown as SensorRepository,
    new CpsMeasurementTransformer(config),
    new ConnectivityRecordMapper(config),
  );

  return {
    processor,
    anchor,
    fetchBytes,
    upsertFetched,
    updateDecodeStatus,
    upsertRecord,
    upsertMany,
    bulkUpsert,
    updateStatus,
  };
}

describe('CpsAnchorProcessorService retry idempotency', () => {
  it.each<FailurePoint>([
    'fetch',
    'raw-payload',
    'record-pending',
    'record-decoded',
    'measurement',
    'sensor',
    'record-projected',
    'payload-status',
    'anchor-status',
  ])('без дублей продолжает обработку после сбоя на шаге %s', async (step) => {
    const harness = await createRetryHarness(step);

    await expect(harness.processor.runOnce()).resolves.toBe(1);
    await expect(harness.processor.runOnce()).resolves.toBe(1);

    const statusCalls = harness.updateStatus.mock.calls as unknown as Array<
      [string, CpsAnchorStatus, Record<string, unknown>]
    >;
    expect(statusCalls.map((call) => call[1])).toContain(
      CpsAnchorStatus.RETRY_PENDING,
    );
    expect(statusCalls.at(-1)?.[1]).toBe(CpsAnchorStatus.PROCESSED);

    const payloadKeys = harness.upsertFetched.mock.calls.map(
      (call: [{ payloadKey: string }]) => call[0].payloadKey,
    );
    expect(new Set(payloadKeys)).toEqual(new Set([harness.anchor.source_key]));

    const recordCalls = harness.upsertRecord.mock.calls as unknown as Array<
      [ConnectivityRecordInput]
    >;
    expect(new Set(recordCalls.map((call) => call[0].record_key))).toEqual(
      new Set([`${harness.anchor.source_key}:0`]),
    );

    const measurementCalls = harness.upsertMany.mock.calls as unknown as Array<
      [Measurement[]]
    >;
    const measurementKeys = measurementCalls.flatMap(([measurements]) =>
      measurements.map(
        (measurement) => `${measurement.sensor_id}:${measurement.timestamp}`,
      ),
    );
    expect(new Set(measurementKeys).size).toBeLessThanOrEqual(1);
    expect(harness.updateDecodeStatus).toHaveBeenLastCalledWith(
      harness.anchor.source_key,
      'decoded',
    );
  });
});
