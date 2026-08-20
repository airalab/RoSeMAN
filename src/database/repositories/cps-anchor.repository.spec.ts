import { type Model } from 'mongoose';
import { CpsAnchorStatus } from '../../common/constants/cps-anchor-status.enum.js';
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
});
