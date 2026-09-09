import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, mongo, Types } from 'mongoose';
import {
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivityStructureStatus,
  ConnectivityPayloadType,
} from '../../common/constants/connectivity-storage.enum.js';
import {
  ConnectivityRecord,
  type ConnectivityRecordDocument,
  type ConnectivityMessageJson,
} from '../schemas/connectivity-record.schema.js';

export interface ConnectivityRecordInput {
  readonly record_key: string;
  readonly payload_key: string;
  readonly envelope_index: number;
  readonly source_type: string;
  readonly node_id?: string;
  readonly block?: number;
  readonly cid?: string;
  readonly sensor_id?: string;
  readonly sensor_id_raw?: Buffer;
  readonly timestamp_ms?: string;
  readonly recorded_at?: Date;
  readonly nonce?: Buffer;
  readonly message_raw?: Buffer;
  readonly message_json?: ConnectivityMessageJson;
  readonly signature?: Buffer;
  readonly structure_status: ConnectivityStructureStatus;
  readonly signature_status: ConnectivitySignatureStatus;
  readonly decode_status: ConnectivityRecordDecodeStatus;
  readonly error_code?: string;
  readonly owner_raw?: Buffer;
  readonly owner?: string;
  readonly payload_type?: ConnectivityPayloadType;
  readonly measurement_types: string[];
  readonly projection_error_code?: string;
}

export interface ConnectivityMessageRecord {
  readonly _id: Types.ObjectId;
  readonly sensor_id_raw: Buffer;
  readonly timestamp_ms: Types.Decimal128;
  readonly recorded_at: Date;
  readonly nonce: Buffer;
  readonly message_json: ConnectivityMessageJson;
  readonly message_raw?: Buffer;
  readonly signature: Buffer;
}

type LeanConnectivityMessageRecord = Omit<
  ConnectivityMessageRecord,
  'sensor_id_raw' | 'nonce' | 'signature' | 'message_raw'
> & {
  readonly sensor_id_raw: Buffer | mongo.Binary;
  readonly nonce: Buffer | mongo.Binary;
  readonly signature: Buffer | mongo.Binary;
  readonly message_raw?: Buffer | mongo.Binary;
};

export interface ConnectivityPublicFilterQuery {
  readonly includeMessageRaw?: boolean;
  readonly start?: Date;
  readonly end?: Date;
  readonly sensorId?: string;
  readonly owner?: string;
  readonly payloadType?: ConnectivityPayloadType;
  readonly measurementType?: string;
}

export interface ConnectivityLatestMessagesQuery extends Omit<
  ConnectivityPublicFilterQuery,
  'start' | 'end'
> {
  readonly start: Date;
  readonly end: Date;
}

export interface ConnectivityPublicPageQuery extends ConnectivityPublicFilterQuery {
  readonly limit: number;
  readonly cursor?: {
    readonly recordedAt: Date;
    readonly recordId: Types.ObjectId;
  };
}

const MESSAGE_RECORD_PROJECTION = {
  _id: 1,
  sensor_id_raw: 1,
  timestamp_ms: 1,
  recorded_at: 1,
  nonce: 1,
  message_json: 1,
  signature: 1,
} as const;

const OPTIONAL_RECORD_FIELDS: ReadonlyArray<keyof ConnectivityRecordInput> = [
  'node_id',
  'block',
  'cid',
  'sensor_id',
  'sensor_id_raw',
  'timestamp_ms',
  'recorded_at',
  'nonce',
  'message_raw',
  'message_json',
  'signature',
  'error_code',
  'owner_raw',
  'owner',
  'payload_type',
  'projection_error_code',
];

/** Преобразует Node.js Buffer или BSON Binary в точный Node.js Buffer. */
function toNodeBuffer(value: Buffer | mongo.Binary): Buffer {
  if (Buffer.isBuffer(value)) return value;
  return Buffer.from(value.buffer.subarray(0, value.position));
}

/** Строит общий MongoDB-фильтр публичных валидных сообщений. */
function buildPublicMessageFilter(
  query: ConnectivityPublicFilterQuery,
): FilterQuery<ConnectivityRecordDocument> {
  return {
    structure_status: ConnectivityStructureStatus.Valid,
    signature_status: ConnectivitySignatureStatus.Valid,
    decode_status: ConnectivityRecordDecodeStatus.Decoded,
    message_json: { $type: 'object' },
    ...(query.start !== undefined || query.end !== undefined
      ? {
          recorded_at: {
            ...(query.start !== undefined ? { $gte: query.start } : {}),
            ...(query.end !== undefined ? { $lt: query.end } : {}),
          },
        }
      : {}),
    ...(query.sensorId ? { sensor_id: query.sensorId } : {}),
    ...(query.owner ? { owner: query.owner } : {}),
    ...(query.payloadType ? { payload_type: query.payloadType } : {}),
    ...(query.measurementType
      ? { measurement_types: query.measurementType }
      : {}),
  };
}

/** Нормализует бинарные поля MongoDB для API-сервиса. */
function normalizeMessageRecords(
  records: readonly LeanConnectivityMessageRecord[],
): ConnectivityMessageRecord[] {
  return records.map(({ message_raw, ...record }) => ({
    ...record,
    sensor_id_raw: toNodeBuffer(record.sensor_id_raw),
    nonce: toNodeBuffer(record.nonce),
    signature: toNodeBuffer(record.signature),
    ...(message_raw !== undefined
      ? { message_raw: toNodeBuffer(message_raw) }
      : {}),
  }));
}

/** Репозиторий occurrence-записей Connectivity Protocol. */
@Injectable()
export class ConnectivityRecordRepository {
  /**
   * Создаёт репозиторий поверх Mongoose-модели protocol records.
   * @param model - модель коллекции connectivity_records
   */
  constructor(
    @InjectModel(ConnectivityRecord.name)
    private readonly model: Model<ConnectivityRecordDocument>,
  ) {}

  /**
   * Идемпотентно создаёт или обновляет occurrence по record_key.
   * @param record - полное текущее представление protocol record
   */
  async upsertRecord(record: ConnectivityRecordInput): Promise<void> {
    const fieldsToUnset = Object.fromEntries(
      OPTIONAL_RECORD_FIELDS.filter((field) => record[field] === undefined).map(
        (field) => [field, ''],
      ),
    );
    await this.model
      .updateOne(
        { record_key: record.record_key },
        {
          $set: record,
          ...(Object.keys(fieldsToUnset).length > 0
            ? { $unset: fieldsToUnset }
            : {}),
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Возвращает валидные records в стабильном порядке для cursor pagination.
   * Запрашивает на один документ больше limit, чтобы вызывающий код определил next cursor.
   * @param query - публичные фильтры и позиция курсора
   * @returns проекция полей SignedEnvelope и служебной позиции cursor
   */
  async findMessagePage(
    query: ConnectivityPublicPageQuery,
  ): Promise<ConnectivityMessageRecord[]> {
    const filter: FilterQuery<ConnectivityRecordDocument> = {
      ...buildPublicMessageFilter(query),
      ...(query.cursor
        ? {
            $or: [
              { recorded_at: { $lt: query.cursor.recordedAt } },
              {
                recorded_at: query.cursor.recordedAt,
                _id: { $lt: query.cursor.recordId },
              },
            ],
          }
        : {}),
    };

    const records = await this.model
      .find(filter, {
        ...MESSAGE_RECORD_PROJECTION,
        ...(query.includeMessageRaw ? { message_raw: 1 } : {}),
      })
      .sort({ recorded_at: -1, _id: -1 })
      .limit(query.limit + 1)
      .lean<LeanConnectivityMessageRecord[]>()
      .exec();

    return normalizeMessageRecords(records);
  }

  /**
   * Возвращает самое новое валидное сообщение каждого сенсора в диапазоне.
   * @param query - обязательный диапазон и необязательные публичные фильтры
   * @returns по одной записи на sensor_id, отсортированной от новой к старой
   */
  async findLatestMessages(
    query: ConnectivityLatestMessagesQuery,
  ): Promise<ConnectivityMessageRecord[]> {
    const records = await this.model
      .aggregate<LeanConnectivityMessageRecord>([
        { $match: buildPublicMessageFilter(query) },
        { $sort: { recorded_at: -1, _id: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            record: { $first: '$$ROOT' },
          },
        },
        { $replaceRoot: { newRoot: '$record' } },
        { $sort: { recorded_at: -1, _id: -1 } },
        {
          $project: {
            ...MESSAGE_RECORD_PROJECTION,
            ...(query.includeMessageRaw ? { message_raw: 1 } : {}),
          },
        },
      ])
      .exec();

    return normalizeMessageRecords(records);
  }
}
