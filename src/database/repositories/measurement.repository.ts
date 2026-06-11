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
 * Запись сенсора с его owner. owner берётся из самого свежего измерения
 * сенсора (поле owner коллекции measurement) и равен пустой строке, если
 * в измерении не указан.
 */
export interface OwnedSensorEntry extends SensorListEntry {
  owner: string;
}

/**
 * Запись сенсора с его device_model и owner. Используется для построения
 * списка маркеров: device_model и owner берутся из самого свежего измерения
 * и нужны для фильтрации insight-сенсоров по владельцу.
 */
export interface MarkerSensorEntry extends OwnedSensorEntry {
  device_model: string;
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
   * Для каждого сенсора берётся последняя запись по timestamp; owner
   * берётся из этого же свежего измерения.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findSensorsInRange(
    start: number,
    end: number,
  ): Promise<OwnedSensorEntry[]> {
    return this.model
      .aggregate<OwnedSensorEntry>([
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
            owner: { $first: { $ifNull: ['$owner', ''] } },
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
            owner: 1,
            timestamp: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Возвращает список уникальных Urban-сенсоров в указанном временном диапазоне.
   * Urban-сенсором считается тот, у которого поле device_model содержит
   * строку "urban" (регистронезависимо) либо device_model не указан.
   * device_model и owner берутся из самого свежего измерения сенсора.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findUrbanSensorsInRange(
    start: number,
    end: number,
  ): Promise<OwnedSensorEntry[]> {
    return this.model
      .aggregate<OwnedSensorEntry>([
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
            device_model: { $first: { $ifNull: ['$device_model', ''] } },
            owner: { $first: { $ifNull: ['$owner', ''] } },
            timestamp: { $first: '$timestamp' },
          },
        },
        {
          $match: {
            $or: [
              { device_model: '' },
              { device_model: { $regex: 'urban', $options: 'i' } },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            sensor_id: '$_id',
            model: 1,
            geo: 1,
            donated_by: 1,
            owner: 1,
            timestamp: 1,
          },
        },
      ])
      .exec();
  }

  /**
   * Возвращает список уникальных сенсоров для отображения маркеров
   * в указанном временном диапазоне: urban-сенсоры (device_model содержит
   * "urban" либо не указан) и insight-сенсоры (device_model содержит
   * "insight"). device_model и owner берутся из самого свежего измерения
   * сенсора и возвращаются вместе с записью для последующей фильтрации
   * insight по владельцу.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findMarkerSensorsInRange(
    start: number,
    end: number,
  ): Promise<MarkerSensorEntry[]> {
    return this.model
      .aggregate<MarkerSensorEntry>([
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
            device_model: { $first: { $ifNull: ['$device_model', ''] } },
            owner: { $first: { $ifNull: ['$owner', ''] } },
            timestamp: { $first: '$timestamp' },
          },
        },
        {
          $match: {
            $or: [
              { device_model: '' },
              { device_model: { $regex: 'urban', $options: 'i' } },
              { device_model: { $regex: 'insight', $options: 'i' } },
            ],
          },
        },
        {
          $project: {
            _id: 0,
            sensor_id: '$_id',
            model: 1,
            geo: 1,
            donated_by: 1,
            device_model: 1,
            owner: 1,
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
   * Возвращает owner указанного сенсора, взятый из его самого свежего
   * измерения за период. Пустая строка — если измерений нет либо owner
   * в них не указан.
   * @param sensorId - идентификатор сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getOwnerBySensorId(
    sensorId: string,
    start: number,
    end: number,
  ): Promise<string> {
    const docs = await this.model
      .aggregate<{ owner: string }>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            sensor_id: sensorId,
            timestamp: { $gte: start, $lte: end },
          },
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            owner: { $first: { $ifNull: ['$owner', ''] } },
          },
        },
      ])
      .exec();

    return docs[0]?.owner ?? '';
  }

  /**
   * Возвращает идентификаторы сенсоров, принадлежащих указанному владельцу
   * за период. Принадлежность определяется по owner из самого свежего
   * измерения сенсора.
   * @param owner - адрес владельца
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async findSensorIdsByOwner(
    owner: string,
    start: number,
    end: number,
  ): Promise<string[]> {
    if (!owner) return [];

    const docs = await this.model
      .aggregate<{ _id: string }>([
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
            owner: { $first: { $ifNull: ['$owner', ''] } },
          },
        },
        { $match: { owner } },
      ])
      .exec();

    return docs.map((doc) => doc._id);
  }

  /**
   * Возвращает device_model для каждого из указанных сенсоров за период.
   * device_model берётся из самого свежего измерения сенсора; сенсоры,
   * у которых device_model не указан (пустой или отсутствует), в карту
   * не попадают.
   * @param sensorIds - идентификаторы сенсоров
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   * @returns карта sensor_id → device_model
   */
  async getDeviceModelsBySensorIds(
    sensorIds: string[],
    start: number,
    end: number,
  ): Promise<Map<string, string>> {
    if (sensorIds.length === 0) return new Map();

    const docs = await this.model
      .aggregate<{ _id: string; device_model: string }>([
        {
          $match: {
            model: { $in: SENSOR_DATA_MODELS },
            sensor_id: { $in: sensorIds },
            timestamp: { $gte: start, $lte: end },
          },
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$sensor_id',
            device_model: { $first: { $ifNull: ['$device_model', ''] } },
          },
        },
        { $match: { device_model: { $ne: '' } } },
      ])
      .exec();

    return new Map(docs.map((doc) => [doc._id, doc.device_model]));
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
