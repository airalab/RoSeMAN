import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SENSOR_DATA_MODELS,
  SensorModel,
} from '../../common/constants/sensor-model.enum.js';
import {
  Measurement,
  type MeasurementDocument,
} from '../schemas/measurement.schema.js';

interface AggregatedMaxEntry {
  _id: string;
  model: number;
  geo: { lat: number; lng: number };
  timestamp: number;
  value: number;
}

export interface SensorListEntry {
  sensor_id: string;
  model: number;
  geo: { lat: number; lng: number };
  donated_by: string;
  timestamp: number;
}

/**
 * Репозиторий для работы с коллекцией measurement.
 */
@Injectable()
export class MeasurementRepository {
  constructor(
    @InjectModel(Measurement.name)
    private readonly model: Model<MeasurementDocument>,
  ) {}

  /**
   * Возвращает максимальное значение измерения заданного типа
   * для каждого сенсора в указанном временном диапазоне.
   * @param type - тип измерения (например `pm10`)
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getMaxByType(
    type: string,
    start: number,
    end: number,
  ): Promise<AggregatedMaxEntry[]> {
    const field = `measurement.${type}`;

    return this.model
      .aggregate<AggregatedMaxEntry>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            timestamp: { $gte: start, $lte: end },
            [field]: { $exists: true },
          },
        },
        { $sort: { [field]: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            model: { $first: '$model' },
            geo: { $first: '$geo' },
            timestamp: { $first: '$timestamp' },
            value: { $first: `$${field}` },
          },
        },
      ])
      .exec();
  }

  /**
   * Возвращает список уникальных сенсоров, имеющих измерения
   * в указанном временном диапазоне.
   * Для каждого сенсора берётся последняя запись по timestamp.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findSensorsInRange(
    start: number,
    end: number,
  ): Promise<SensorListEntry[]> {
    return this.model
      .aggregate<SensorListEntry>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            timestamp: { $gte: start, $lte: end },
          },
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            model: { $first: '$model' },
            geo: { $first: '$geo' },
            donated_by: { $first: { $ifNull: ['$donated_by', ''] } },
            timestamp: { $first: '$timestamp' },
          },
        },
        {
          $project: {
            _id: 0,
            sensor_id: '$_id',
            model: 1,
            geo: 1,
            donated_by: 1,
            timestamp: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Возвращает список уникальных сенсоров, у которых НЕТ измерений co2
   * в указанном временном диапазоне.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findUrbanSensorsInRange(
    start: number,
    end: number,
  ): Promise<SensorListEntry[]> {
    return this.model
      .aggregate<SensorListEntry>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            timestamp: { $gte: start, $lte: end },
          },
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            model: { $first: '$model' },
            geo: { $first: '$geo' },
            donated_by: { $first: { $ifNull: ['$donated_by', ''] } },
            timestamp: { $first: '$timestamp' },
            hasCo2: {
              $max: {
                $cond: [{ $ifNull: ['$measurement.co2', false] }, 1, 0],
              },
            },
          },
        },
        { $match: { hasCo2: 0 } },
        {
          $project: {
            _id: 0,
            sensor_id: '$_id',
            model: 1,
            geo: 1,
            donated_by: 1,
            timestamp: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Возвращает уникальные типы измерений (ключи поля measurement)
   * за указанный временной диапазон.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getDistinctMeasurementTypes(
    start: number,
    end: number,
  ): Promise<string[]> {
    const docs = await this.model
      .aggregate<{
        _id: string;
      }>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            timestamp: { $gte: start, $lte: end },
          },
        },
        { $project: { keys: { $objectToArray: '$measurement' } } },
        { $unwind: '$keys' },
        { $group: { _id: '$keys.k' } },
        { $sort: { _id: 1 } },
      ])
      .exec();

    return docs.map((d) => d._id);
  }

  /**
   * Возвращает измерения конкретного сенсора за указанный временной диапазон.
   * @param sensorId - идентификатор сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findBySensorInRange(
    sensorId: string,
    start: number,
    end: number,
  ): Promise<
    Array<{
      data: Record<string, unknown>;
      timestamp: number;
      geo: { lat: number; lng: number };
    }>
  > {
    return this.model
      .find(
        {
          model: { $in: SENSOR_DATA_MODELS },
          sensor_id: sensorId,
          timestamp: { $gte: start, $lte: end },
        } as Record<string, unknown>,
        { _id: 0, measurement: 1, timestamp: 1, geo: 1 },
      )
      .sort({ timestamp: 1 })
      .lean()
      .then((docs) =>
        docs.map((doc) => ({
          data: doc.measurement,
          timestamp: doc.timestamp,
          geo: doc.geo,
        })),
      );
  }

  /**
   * Возвращает измерения за указанный временной диапазон,
   * сгруппированные по sensor_id.
   * Фильтрация по GPS-области (bound) или списку sensor_id.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   * @param options - geo-bound или список sensor_id для фильтрации
   */
  async findGroupedByArea(
    start: number,
    end: number,
    options:
      | { bound: { south: number; west: number; north: number; east: number } }
      | { sensorIds: string[] },
  ): Promise<
    Record<
      string,
      Array<{
        data: Record<string, unknown>;
        timestamp: number;
        geo: { lat: number; lng: number };
      }>
    >
  > {
    const match: Record<string, unknown> = {
      model: { $in: SENSOR_DATA_MODELS },
      timestamp: { $gte: start, $lte: end },
    };

    if ('bound' in options) {
      const { south, west, north, east } = options.bound;
      match['geo.lat'] = { $gte: south, $lte: north };
      match['geo.lng'] = { $gte: west, $lte: east };
    } else {
      match.sensor_id = { $in: options.sensorIds };
    }

    const docs = await this.model
      .find(match, {
        _id: 0,
        sensor_id: 1,
        measurement: 1,
        timestamp: 1,
        geo: 1,
      })
      .sort({ timestamp: 1 })
      .lean()
      .exec();

    const result: Record<
      string,
      Array<{
        data: Record<string, unknown>;
        timestamp: number;
        geo: { lat: number; lng: number };
      }>
    > = {};

    for (const doc of docs) {
      const entry = {
        data: doc.measurement,
        timestamp: doc.timestamp,
        geo: doc.geo,
      };

      if (result[doc.sensor_id]) {
        result[doc.sensor_id].push(entry);
      } else {
        result[doc.sensor_id] = [entry];
      }
    }

    return result;
  }

  /**
   * Возвращает плоский массив измерений для указанных сенсоров
   * за временной диапазон. Каждый документ содержит sensor_id.
   * @param sensorIds - список идентификаторов сенсоров
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findFlatBySensorIds(
    sensorIds: string[],
    start: number,
    end: number,
  ): Promise<
    Array<{
      sensor_id: string;
      measurement: Record<string, unknown>;
      timestamp: number;
      geo: { lat: number; lng: number };
    }>
  > {
    return this.model
      .find(
        {
          model: { $in: SENSOR_DATA_MODELS },
          sensor_id: { $in: sensorIds },
          timestamp: { $gte: start, $lte: end },
        } as Record<string, unknown>,
        { _id: 0, sensor_id: 1, measurement: 1, timestamp: 1, geo: 1 },
      )
      .sort({ timestamp: 1 })
      .lean()
      .exec();
  }

  /**
   * Возвращает записи-сообщения (model === MESSAGE) за указанный временной диапазон.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findMessages(
    start: number,
    end: number,
  ): Promise<
    Array<{
      sensor_id: string;
      measurement: Record<string, unknown>;
      timestamp: number;
      geo: { lat: number; lng: number };
    }>
  > {
    return this.model
      .find(
        {
          model: SensorModel.MESSAGE,
          timestamp: { $gte: start, $lte: end },
        } as Record<string, unknown>,
        { _id: 0, sensor_id: 1, measurement: 1, timestamp: 1, geo: 1 },
      )
      .sort({ timestamp: 1 })
      .lean()
      .exec();
  }

  /**
   * Вставляет массив документов, игнорируя ошибки дублирования (code 11000).
   * @param docs - массив документов для вставки
   */
  async insertManyIgnoreDuplicates(
    docs: Parameters<Model<MeasurementDocument>['insertMany']>[0],
  ): Promise<void> {
    await this.model
      .insertMany(docs, { ordered: false })
      .catch((err: unknown) => {
        const code = (err as Record<string, unknown>)?.code;
        if (code !== 11000) throw err;
      });
  }
}
