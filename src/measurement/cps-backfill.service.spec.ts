import { create, toBinary } from '@bufbuild/protobuf';
import { ConfigService } from '@nestjs/config';
import {
  MessageSchema,
  MetaSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import { EncryptedSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/encrypted_pb.js';
import {
  SignedEnvelopeBatchSchema,
  SignedEnvelopeSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
import { UrbanSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/device/v1/urban_pb.js';
import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
} from '@polkadot/util-crypto';
import { CpsBackfillStatus } from '../common/constants/cps-backfill-status.enum.js';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { ConnectivityPayloadRepository } from '../database/repositories/connectivity-payload.repository.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from '../database/repositories/connectivity-record.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import { ConnectivityRecordMapper } from './connectivity-record.mapper.js';
import { CpsBackfillService } from './cps-backfill.service.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { buildEnvelopeSigningBytes } from './protocol/envelope-signature-verifier.js';
import { ProtocolBatchWireFormat } from './protocol/signed-envelope-batch-payload.decoder.js';

/** Создаёт signed Urban batch с одной private-секцией. */
async function createSignedBatch(): Promise<Uint8Array> {
  await cryptoWaitReady();
  const pair = ed25519PairFromSeed(new Uint8Array(32).fill(10));
  const message = toBinary(
    MessageSchema,
    create(MessageSchema, {
      metadata: create(MetaSchema, { owner: pair.publicKey }),
      payload: {
        case: 'urban',
        value: create(UrbanSchema, {
          public: [],
          private: [
            create(EncryptedSchema, {
              version: 1,
              algorithm: 'xchacha20',
              from: new Uint8Array([1, 2]),
              nonce: new Uint8Array([3, 4]),
              ciphertext: new Uint8Array([5, 6, 7]),
            }),
          ],
        }),
      },
    }),
  );
  const unsigned = {
    sensorId: pair.publicKey,
    timestamp: 1_787_594_400_777n,
    nonce: new Uint8Array(16).fill(3),
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

/** Создаёт ConfigService для raw backfill fixture. */
function createConfig(): ConfigService {
  const values: Record<string, unknown> = {
    'cps.batchWireFormat': ProtocolBatchWireFormat.Raw,
    'cps.ownerSs58Prefix': 32,
  };
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  } as unknown as ConfigService;
}

describe('CpsBackfillService', () => {
  const anchor = {
    source_key: 'cps:10:backfill',
    node_id: '10',
    block: 100,
    cid: 'QmBackfill',
  } as CpsAnchorDocument;

  it('в dry-run только возвращает число кандидатов', async () => {
    const findBackfillCandidates = jest.fn().mockResolvedValue([anchor]);
    const fetchBytes = jest.fn();
    const markBackfillStarted = jest.fn();
    const service = new CpsBackfillService(
      createConfig(),
      { fetchBytes } as unknown as IpfsFetcherService,
      {
        findBackfillCandidates,
        markBackfillStarted,
      } as unknown as CpsAnchorRepository,
      {} as ConnectivityPayloadRepository,
      {} as ConnectivityRecordRepository,
      new ConnectivityRecordMapper(createConfig()),
    );

    const report = await service.run({ dryRun: true, limit: 25 });

    expect(report).toMatchObject({ dryRun: true, anchors: 1, processed: 0 });
    expect(findBackfillCandidates).toHaveBeenCalledWith({
      dryRun: true,
      limit: 25,
    });
    expect(markBackfillStarted).not.toHaveBeenCalled();
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('сохраняет raw/canonical данные без legacy projection', async () => {
    const batchBytes = await createSignedBatch();
    const markBackfillStarted = jest.fn().mockResolvedValue(undefined);
    const updateBackfillResult = jest.fn().mockResolvedValue(undefined);
    const upsertFetched = jest.fn().mockResolvedValue(undefined);
    const updateDecodeStatus = jest.fn().mockResolvedValue(undefined);
    const upsertRecord = jest.fn().mockResolvedValue(undefined);
    const config = createConfig();
    const service = new CpsBackfillService(
      config,
      {
        fetchBytes: jest.fn().mockResolvedValue(batchBytes),
      } as unknown as IpfsFetcherService,
      {
        findBackfillCandidates: jest.fn().mockResolvedValue([anchor]),
        markBackfillStarted,
        updateBackfillResult,
      } as unknown as CpsAnchorRepository,
      {
        upsertFetched,
        updateDecodeStatus,
      } as unknown as ConnectivityPayloadRepository,
      { upsertRecord } as unknown as ConnectivityRecordRepository,
      new ConnectivityRecordMapper(config),
    );

    const report = await service.run({ dryRun: false, limit: 10 });

    expect(report).toEqual({
      dryRun: false,
      anchors: 1,
      processed: 1,
      processedWithErrors: 0,
      failed: 0,
      records: 1,
      invalid: 0,
      unsupported: 0,
      privateSections: 1,
      privateOnly: 1,
      failures: [],
    });
    expect(upsertFetched).toHaveBeenCalledWith(
      expect.objectContaining({ rawPayload: batchBytes }),
    );
    const recordCalls = upsertRecord.mock.calls as unknown as Array<
      [ConnectivityRecordInput]
    >;
    expect(recordCalls.at(-1)?.[0]).toMatchObject({
      decode_status: 'decoded',
      legacy_projection_status: 'not_attempted',
      private_sections: [
        {
          version: 1,
          algorithm: 'xchacha20',
          from: Buffer.from([1, 2]),
          nonce: Buffer.from([3, 4]),
          ciphertext: Buffer.from([5, 6, 7]),
        },
      ],
    });
    expect(updateBackfillResult).toHaveBeenCalledWith(
      anchor.source_key,
      CpsBackfillStatus.Processed,
      {
        recordCount: 1,
        invalidCount: 0,
        unsupportedCount: 0,
        privateSectionCount: 1,
        privateOnlyCount: 1,
      },
    );
  });

  it('сохраняет raw payload и отдельную terminal error при malformed batch', async () => {
    const updateDecodeStatus = jest.fn().mockResolvedValue(undefined);
    const updateBackfillResult = jest.fn().mockResolvedValue(undefined);
    const config = createConfig();
    const service = new CpsBackfillService(
      config,
      {
        fetchBytes: jest.fn().mockResolvedValue(new Uint8Array([255])),
      } as unknown as IpfsFetcherService,
      {
        findBackfillCandidates: jest.fn().mockResolvedValue([anchor]),
        markBackfillStarted: jest.fn().mockResolvedValue(undefined),
        updateBackfillResult,
      } as unknown as CpsAnchorRepository,
      {
        upsertFetched: jest.fn().mockResolvedValue(undefined),
        updateDecodeStatus,
      } as unknown as ConnectivityPayloadRepository,
      { upsertRecord: jest.fn() } as unknown as ConnectivityRecordRepository,
      new ConnectivityRecordMapper(config),
    );

    const report = await service.run({ dryRun: false, limit: 10 });

    expect(report.failed).toBe(1);
    expect(report.failures).toEqual([
      {
        sourceKey: anchor.source_key,
        cid: anchor.cid,
        code: 'MALFORMED_PROTOBUF',
      },
    ]);
    expect(updateDecodeStatus).toHaveBeenCalledWith(
      anchor.source_key,
      'error',
      expect.objectContaining({ code: 'MALFORMED_PROTOBUF' }),
    );
    expect(updateBackfillResult).toHaveBeenCalledWith(
      anchor.source_key,
      CpsBackfillStatus.Error,
      expect.objectContaining({ errorCode: 'MALFORMED_PROTOBUF' }),
    );
  });
});
