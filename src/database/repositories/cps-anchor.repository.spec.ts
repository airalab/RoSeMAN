import { type Model } from 'mongoose';
import { CpsAnchorStatus } from '../../common/constants/cps-anchor-status.enum.js';
import { CpsBackfillStatus } from '../../common/constants/cps-backfill-status.enum.js';
import { MAX_CPS_NODE_ID } from '../../common/utils/cps-node-id.util.js';
import { type CpsAnchorDocument } from '../schemas/cps-anchor.schema.js';
import { CpsAnchorRepository } from './cps-anchor.repository.js';

interface ModelMock {
  readonly updateOne: jest.Mock;
  readonly findOneAndUpdate: jest.Mock;
  readonly countDocuments: jest.Mock;
}

/**
 * Создаёт минимальный mock Mongoose-модели для тестов репозитория.
 * @returns mock методов, используемых CpsAnchorRepository
 */
function createModelMock(): ModelMock {
  return {
    updateOne: jest.fn(),
    findOneAndUpdate: jest.fn(),
    countDocuments: jest.fn(),
  };
}

/**
 * Преобразует тестовый mock к типу Mongoose-модели.
 * @param mock - минимальный mock методов модели
 * @returns модель для передачи в конструктор репозитория
 */
function asModel(mock: ModelMock): Model<CpsAnchorDocument> {
  return mock as unknown as Model<CpsAnchorDocument>;
}

describe('CpsAnchorRepository', () => {
  it('сохраняет максимальный u64 NodeId без преобразования в number', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue(undefined);
    model.updateOne.mockReturnValue({ exec });
    const repository = new CpsAnchorRepository(asModel(model));
    const cid = `b${'a'.repeat(58)}`;

    await repository.upsertAnchor({
      nodeId: MAX_CPS_NODE_ID,
      block: 123,
      cid,
      owner: 'owner',
    });

    const sourceKey = `cps:${MAX_CPS_NODE_ID.toString()}:${cid}`;
    const [filter, update, options] = model.updateOne.mock
      .calls[0] as unknown as [
      { source_key: string },
      { $setOnInsert: Record<string, unknown> },
      { upsert: boolean },
    ];
    expect(filter).toEqual({ source_key: sourceKey });
    expect(update.$setOnInsert).toEqual({
      source_key: sourceKey,
      node_id: MAX_CPS_NODE_ID.toString(),
      block: 123,
      cid,
      owner: 'owner',
      status: CpsAnchorStatus.PENDING,
      attempt_count: 0,
      valid_envelope_count: 0,
      invalid_envelope_count: 0,
      envelope_count: 0,
      stored_record_count: 0,
      valid_signature_count: 0,
      invalid_signature_count: 0,
      decoded_count: 0,
      unsupported_count: 0,
      legacy_projection_count: 0,
      private_section_count: 0,
      backfill_attempt_count: 0,
    });
    expect(options).toEqual({ upsert: true });
    expect(exec).toHaveBeenCalled();
  });

  it('атомарно захватывает pending anchor и устанавливает lease', async () => {
    const model = createModelMock();
    const document = { source_key: 'cps:1:cid' } as CpsAnchorDocument;
    const exec = jest.fn().mockResolvedValue(document);
    model.findOneAndUpdate.mockReturnValue({ exec });
    const repository = new CpsAnchorRepository(asModel(model));
    const now = new Date('2026-08-20T10:00:00.000Z');

    const result = await repository.claimNext(now, 30_000);

    expect(result).toBe(document);
    const [filter, update, options] = model.findOneAndUpdate.mock
      .calls[0] as unknown as [
      { $or: unknown[] },
      {
        $set: Record<string, unknown>;
        $inc: Record<string, unknown>;
        $unset: Record<string, unknown>;
      },
      Record<string, unknown>,
    ];
    expect(filter.$or).toHaveLength(3);
    expect(update).toEqual({
      $set: {
        status: CpsAnchorStatus.PROCESSING,
        lease_expires_at: new Date('2026-08-20T10:00:30.000Z'),
      },
      $inc: { attempt_count: 1 },
      $unset: { error_code: '', error_message: '' },
    });
    expect(options).toEqual({
      new: true,
      sort: { block: 1, createdAt: 1 },
    });
  });

  it('отклоняет небезопасный номер блока до обращения к MongoDB', async () => {
    const model = createModelMock();
    const repository = new CpsAnchorRepository(asModel(model));

    await expect(
      repository.upsertAnchor({
        nodeId: 1n,
        block: Number.MAX_SAFE_INTEGER + 1,
        cid: `b${'a'.repeat(58)}`,
      }),
    ).rejects.toThrow('CPS anchor block must be a safe unsigned integer');
    expect(model.updateOne).not.toHaveBeenCalled();
  });

  it('атомарно сохраняет раздельные processing counters', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue(undefined);
    model.updateOne.mockReturnValue({ exec });
    const repository = new CpsAnchorRepository(asModel(model));

    await repository.updateStatus(
      'cps:1:cid',
      CpsAnchorStatus.PROCESSED_WITH_ERRORS,
      {
        envelopeCount: 8,
        storedRecordCount: 8,
        validSignatureCount: 6,
        invalidSignatureCount: 1,
        decodedCount: 5,
        unsupportedCount: 1,
        legacyProjectionCount: 4,
        privateSectionCount: 3,
        errorCode: 'ENVELOPE_ERRORS',
      },
    );

    const [, update] = model.updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      { $set: Record<string, unknown> },
    ];
    expect(update.$set).toMatchObject({
      status: CpsAnchorStatus.PROCESSED_WITH_ERRORS,
      envelope_count: 8,
      stored_record_count: 8,
      valid_signature_count: 6,
      invalid_signature_count: 1,
      decoded_count: 5,
      unsupported_count: 1,
      legacy_projection_count: 4,
      private_section_count: 3,
      error_code: 'ENVELOPE_ERRORS',
    });
  });

  it('выбирает только незавершённые backfill anchors в заданном диапазоне', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue([]);
    const limit = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    Object.assign(model, { find });
    const repository = new CpsAnchorRepository(asModel(model));

    await repository.findBackfillCandidates({
      startBlock: 10,
      endBlock: 20,
      cid: 'cid',
      limit: 25,
    });

    expect(find).toHaveBeenCalledWith({
      status: {
        $in: [CpsAnchorStatus.PROCESSED, CpsAnchorStatus.PROCESSED_WITH_ERRORS],
      },
      block: { $gte: 10, $lte: 20 },
      cid: 'cid',
      backfill_status: {
        $nin: [
          CpsBackfillStatus.Processed,
          CpsBackfillStatus.ProcessedWithErrors,
        ],
      },
    });
    expect(sort).toHaveBeenCalledWith({ block: 1, source_key: 1 });
    expect(limit).toHaveBeenCalledWith(25);
    expect(exec).toHaveBeenCalled();
  });

  it('обновляет backfill state без изменения основного status', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue(undefined);
    model.updateOne.mockReturnValue({ exec });
    const repository = new CpsAnchorRepository(asModel(model));
    const completedAt = new Date('2026-09-01T10:00:00.000Z');

    await repository.markBackfillStarted(
      'cps:1:cid',
      new Date('2026-09-01T09:00:00.000Z'),
    );
    await repository.updateBackfillResult(
      'cps:1:cid',
      CpsBackfillStatus.ProcessedWithErrors,
      {
        recordCount: 4,
        invalidCount: 1,
        unsupportedCount: 1,
        privateSectionCount: 2,
        privateOnlyCount: 1,
        errorCode: 'PARTIAL_ERRORS',
        errorMessage: 'One record was invalid',
        completedAt,
      },
    );

    const updateCalls = model.updateOne.mock.calls as unknown as Array<
      [
        Record<string, unknown>,
        {
          $set: Record<string, unknown>;
          $inc: Record<string, unknown>;
        },
      ]
    >;
    const startUpdate = updateCalls[0][1];
    expect(startUpdate.$set).not.toHaveProperty('status');
    expect(startUpdate.$set.backfill_status).toBe(CpsBackfillStatus.Processing);
    expect(startUpdate.$inc).toEqual({ backfill_attempt_count: 1 });
    const resultUpdate = updateCalls[1][1];
    expect(resultUpdate.$set).not.toHaveProperty('status');
    expect(resultUpdate.$set).toMatchObject({
      backfill_status: CpsBackfillStatus.ProcessedWithErrors,
      backfilled_at: completedAt,
      backfill_record_count: 4,
      backfill_invalid_count: 1,
      backfill_unsupported_count: 1,
      backfill_private_section_count: 2,
      backfill_private_only_count: 1,
      backfill_error_code: 'PARTIAL_ERRORS',
    });
  });

  it('отклоняет неверный диапазон backfill до запроса MongoDB', async () => {
    const model = createModelMock();
    const repository = new CpsAnchorRepository(asModel(model));

    await expect(
      repository.findBackfillCandidates({
        startBlock: 20,
        endBlock: 10,
        limit: 25,
      }),
    ).rejects.toThrow('startBlock must not exceed endBlock');
  });
});
