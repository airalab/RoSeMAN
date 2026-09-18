import { mongo, type Model, Types } from 'mongoose';
import {
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivitySourceType,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';
import type { ConnectivityRecordDocument } from '../schemas/connectivity-record.schema.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from './connectivity-record.repository.js';

describe('ConnectivityRecordRepository', () => {
  it('выполняет идемпотентный upsert строго по record_key', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const model = {
      updateOne,
    } as unknown as Model<ConnectivityRecordDocument>;
    const repository = new ConnectivityRecordRepository(model);
    const record: ConnectivityRecordInput = {
      record_key: 'cps:1:cid:0',
      payload_key: 'cps:1:cid',
      envelope_index: 0,
      source_type: ConnectivitySourceType.Cps,
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Pending,
      decode_status: ConnectivityRecordDecodeStatus.Pending,
      measurement_types: [],
    };

    await repository.upsertRecord(record);

    const updateCalls = updateOne.mock.calls as unknown as Array<
      [
        unknown,
        { $set: ConnectivityRecordInput; $unset: Record<string, string> },
        unknown,
      ]
    >;
    expect(updateCalls[0][0]).toEqual({ record_key: record.record_key });
    expect(updateCalls[0][1].$set).toBe(record);
    expect(updateCalls[0][1].$unset).toMatchObject({
      error_code: '',
      message_json: '',
      owner: '',
      owner_raw: '',
      projection_error_code: '',
    });
    expect(updateCalls[0][2]).toEqual({ upsert: true });
    expect(exec).toHaveBeenCalled();
  });

  it('строит запрос с фильтрами, cursor и проекцией SignedEnvelope', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn().mockReturnValue({ exec });
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const model = { find } as unknown as Model<ConnectivityRecordDocument>;
    const repository = new ConnectivityRecordRepository(model);
    const start = new Date('2026-09-01T00:00:00.123Z');
    const end = new Date('2026-09-02T00:00:00.456Z');
    const cursorDate = new Date('2026-09-01T12:00:00.789Z');
    const cursorId = new Types.ObjectId('68b95ae07796696240566a01');

    await expect(
      repository.findMessagePage({
        limit: 25,
        start,
        end,
        cursor: { recordedAt: cursorDate, recordId: cursorId },
        sensorId: 'aa'.repeat(32),
        nodeId: '42',
        payloadType: ConnectivityPayloadType.Urban,
        measurementType: 'temperature',
      }),
    ).resolves.toEqual([]);

    expect(find).toHaveBeenCalledWith(
      {
        structure_status: ConnectivityStructureStatus.Valid,
        signature_status: ConnectivitySignatureStatus.Valid,
        decode_status: ConnectivityRecordDecodeStatus.Decoded,
        message_json: { $type: 'object' },
        recorded_at: { $gte: start, $lt: end },
        sensor_id: 'aa'.repeat(32),
        node_id: '42',
        payload_type: 'urban',
        measurement_types: 'temperature',
        $or: [
          { recorded_at: { $lt: cursorDate } },
          {
            recorded_at: cursorDate,
            _id: { $lt: cursorId },
          },
        ],
      },
      expect.objectContaining({
        _id: 1,
        sensor_id_raw: 1,
        timestamp_ms: 1,
        nonce: 1,
        message_json: 1,
        signature: 1,
      }),
    );
    const findCalls = find.mock.calls as unknown as Array<
      [unknown, Record<string, number>]
    >;
    const projection = findCalls[0][1];
    expect(projection).not.toHaveProperty('owner_raw');
    expect(projection).not.toHaveProperty('measurement_types');
    expect(projection).not.toHaveProperty('message_raw');
    expect(sort).toHaveBeenCalledWith({ recorded_at: -1, _id: -1 });
    expect(limit).toHaveBeenCalledWith(26);
    expect(lean).toHaveBeenCalled();
    expect(exec).toHaveBeenCalled();
  });

  it('не добавляет recorded_at без границ и поддерживает одну границу', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn().mockReturnValue({ exec });
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const model = { find } as unknown as Model<ConnectivityRecordDocument>;
    const repository = new ConnectivityRecordRepository(model);
    const start = new Date('2026-09-01T00:00:00.123Z');

    await repository.findMessagePage({ limit: 1000 });
    await repository.findMessagePage({ limit: 1000, start });

    const commonFilter = {
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Valid,
      decode_status: ConnectivityRecordDecodeStatus.Decoded,
      message_json: { $type: 'object' },
    };
    expect(find).toHaveBeenNthCalledWith(1, commonFilter, expect.any(Object));
    expect(find).toHaveBeenNthCalledWith(
      2,
      { ...commonFilter, recorded_at: { $gte: start } },
      expect.any(Object),
    );
  });

  it.each([false, true])(
    'агрегирует последние сообщения с includeMessageRaw=%s',
    async (includeMessageRaw) => {
      const sensorId = Buffer.alloc(32, 1);
      const nonce = Buffer.alloc(16, 2);
      const signature = Buffer.alloc(64, 3);
      const messageRaw = new mongo.Binary();
      messageRaw.put(255);
      messageRaw.put(0);
      const record = {
        _id: new Types.ObjectId('68b95ae07796696240566a01'),
        sensor_id_raw: new mongo.Binary(sensorId),
        timestamp_ms: Types.Decimal128.fromString('1788517399949'),
        recorded_at: new Date('2026-09-04T10:23:19.949Z'),
        nonce: new mongo.Binary(nonce),
        message_json: { metadata: {} },
        signature: new mongo.Binary(signature),
        ...(includeMessageRaw ? { message_raw: messageRaw } : {}),
      };
      const exec = jest.fn().mockResolvedValue([record]);
      const aggregate = jest.fn().mockReturnValue({ exec });
      const model = {
        aggregate,
      } as unknown as Model<ConnectivityRecordDocument>;
      const repository = new ConnectivityRecordRepository(model);
      const start = new Date('2026-09-04T00:00:00.000Z');
      const end = new Date('2026-09-05T00:00:00.000Z');

      const result = await repository.findLatestMessages({
        includeMessageRaw,
        start,
        end,
        measurementType: 'temperature',
      });

      expect(aggregate).toHaveBeenCalledWith([
        {
          $match: {
            structure_status: ConnectivityStructureStatus.Valid,
            signature_status: ConnectivitySignatureStatus.Valid,
            decode_status: ConnectivityRecordDecodeStatus.Decoded,
            message_json: { $type: 'object' },
            recorded_at: { $gte: start, $lt: end },
            measurement_types: 'temperature',
          },
        },
        { $sort: { recorded_at: -1, _id: -1 } },
        { $group: { _id: '$sensor_id', record: { $first: '$$ROOT' } } },
        { $replaceRoot: { newRoot: '$record' } },
        { $sort: { recorded_at: -1, _id: -1 } },
        {
          $project: {
            _id: 1,
            sensor_id_raw: 1,
            timestamp_ms: 1,
            recorded_at: 1,
            nonce: 1,
            message_json: 1,
            signature: 1,
            ...(includeMessageRaw ? { message_raw: 1 } : {}),
          },
        },
      ]);
      expect(result).toEqual([
        {
          ...record,
          sensor_id_raw: sensorId,
          nonce,
          signature,
          ...(includeMessageRaw ? { message_raw: Buffer.from([255, 0]) } : {}),
        },
      ]);
    },
  );

  it.each([false, true])(
    'нормализует BSON Binary с includeMessageRaw=%s',
    async (includeMessageRaw) => {
      const sensorId = Buffer.alloc(32, 1);
      const nonce = Buffer.alloc(16, 2);
      const signature = Buffer.alloc(64, 3);
      const messageRaw = new mongo.Binary();
      messageRaw.put(255);
      messageRaw.put(0);
      const record = {
        _id: new Types.ObjectId('68b95ae07796696240566a01'),
        sensor_id_raw: new mongo.Binary(sensorId),
        timestamp_ms: Types.Decimal128.fromString('1788517399949'),
        recorded_at: new Date('2026-09-04T10:23:19.949Z'),
        nonce: new mongo.Binary(nonce),
        message_json: { metadata: {} },
        signature: new mongo.Binary(signature),
        ...(includeMessageRaw ? { message_raw: messageRaw } : {}),
      };
      const exec = jest.fn().mockResolvedValue([record]);
      const lean = jest.fn().mockReturnValue({ exec });
      const limit = jest.fn().mockReturnValue({ lean });
      const sort = jest.fn().mockReturnValue({ limit });
      const find = jest.fn().mockReturnValue({ sort });
      const model = { find } as unknown as Model<ConnectivityRecordDocument>;
      const repository = new ConnectivityRecordRepository(model);

      const result = await repository.findMessagePage({
        includeMessageRaw,
        limit: 1,
        start: new Date('2026-09-04T00:00:00.000Z'),
        end: new Date('2026-09-05T00:00:00.000Z'),
      });

      expect(result).toEqual([
        {
          ...record,
          sensor_id_raw: sensorId,
          nonce,
          signature,
          ...(includeMessageRaw ? { message_raw: Buffer.from([255, 0]) } : {}),
        },
      ]);
      expect(find).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({
          ...(includeMessageRaw ? { message_raw: 1 } : { message_json: 1 }),
        }),
      );
      expect(Buffer.isBuffer(result[0].sensor_id_raw)).toBe(true);
      expect(Buffer.isBuffer(result[0].nonce)).toBe(true);
      expect(Buffer.isBuffer(result[0].signature)).toBe(true);
    },
  );
});
