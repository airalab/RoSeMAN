import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { SensorLocationStatus } from '../../common/constants/sensor-location-status.enum.js';
import {
  SensorLocation,
  type SensorLocationDocument,
} from '../schemas/sensor-location.schema.js';

export interface SensorLocationCandidate {
  readonly sensorId: string;
  readonly geo: { lat: number; lng: number };
  readonly sourceRecordKey: string;
  readonly sourceRecordId: Types.ObjectId;
  readonly sourceRecordedAt: Date;
}

export interface PendingSensorLocation {
  readonly _id: Types.ObjectId;
  readonly sensor_id: string;
  readonly geo: { lat: number; lng: number };
  readonly source_record_key: string;
}

/** Репозиторий актуальных координат и геокодированных данных CPS-сенсоров. */
@Injectable()
export class SensorLocationRepository {
  /**
   * Создаёт репозиторий актуальных локаций.
   * @param model - модель коллекции sensor_locations
   */
  constructor(
    @InjectModel(SensorLocation.name)
    private readonly model: Model<SensorLocationDocument>,
  ) {}

  /**
   * Атомарно применяет более свежие GPS-позиции сенсоров.
   * При изменении координат сбрасывает результат reverse geocoding.
   * @param candidates - последние валидные CPS-позиции
   */
  async upsertCandidates(
    candidates: readonly SensorLocationCandidate[],
  ): Promise<void> {
    for (const candidate of candidates) {
      const newerSource = {
        $or: [
          {
            $eq: [{ $type: '$source_recorded_at' }, 'missing'],
          },
          { $lt: ['$source_recorded_at', candidate.sourceRecordedAt] },
          {
            $and: [
              { $eq: ['$source_recorded_at', candidate.sourceRecordedAt] },
              { $lt: ['$source_record_id', candidate.sourceRecordId] },
            ],
          },
        ],
      };
      const coordinatesChanged = {
        $or: [
          { $ne: ['$geo.lat', candidate.geo.lat] },
          { $ne: ['$geo.lng', candidate.geo.lng] },
        ],
      };
      const resetGeocoding = { $and: [newerSource, coordinatesChanged] };

      await this.model
        .updateOne(
          { sensor_id: candidate.sensorId },
          [
            {
              $set: {
                sensor_id: { $ifNull: ['$sensor_id', candidate.sensorId] },
                geo: { $cond: [newerSource, candidate.geo, '$geo'] },
                source_record_key: {
                  $cond: [
                    newerSource,
                    candidate.sourceRecordKey,
                    '$source_record_key',
                  ],
                },
                source_record_id: {
                  $cond: [
                    newerSource,
                    candidate.sourceRecordId,
                    '$source_record_id',
                  ],
                },
                source_recorded_at: {
                  $cond: [
                    newerSource,
                    candidate.sourceRecordedAt,
                    '$source_recorded_at',
                  ],
                },
                city: {
                  $cond: [resetGeocoding, null, { $ifNull: ['$city', null] }],
                },
                region: {
                  $cond: [resetGeocoding, null, { $ifNull: ['$region', null] }],
                },
                country: {
                  $cond: [
                    resetGeocoding,
                    null,
                    { $ifNull: ['$country', null] },
                  ],
                },
                geocoding_status: {
                  $cond: [
                    resetGeocoding,
                    SensorLocationStatus.Pending,
                    {
                      $ifNull: [
                        '$geocoding_status',
                        SensorLocationStatus.Pending,
                      ],
                    },
                  ],
                },
              },
            },
          ],
          { upsert: true },
        )
        .exec();
    }
  }

  /**
   * Возвращает ожидающие reverse geocoding позиции.
   * @param limit - максимальное число позиций
   */
  async findPending(limit: number): Promise<PendingSensorLocation[]> {
    return this.model
      .find(
        {
          $or: [
            { geocoding_status: SensorLocationStatus.Pending },
            {
              geocoding_status: SensorLocationStatus.Resolved,
              region: { $exists: false },
            },
          ],
        },
        { sensor_id: 1, geo: 1, source_record_key: 1 },
      )
      .sort({ geocoding_status: 1, updatedAt: 1, _id: 1 })
      .limit(limit)
      .lean<PendingSensorLocation[]>()
      .exec();
  }

  /**
   * Сохраняет успешно определённые город, регион и страну, если GPS актуален.
   * @param location - ожидающая позиция
   * @param city - название города
   * @param region - название региона или пустая строка
   * @param country - название страны
   */
  async markResolved(
    location: PendingSensorLocation,
    city: string,
    region: string,
    country: string,
  ): Promise<void> {
    await this.model
      .updateOne(
        {
          _id: location._id,
          source_record_key: location.source_record_key,
          $or: [
            { geocoding_status: SensorLocationStatus.Pending },
            {
              geocoding_status: SensorLocationStatus.Resolved,
              region: { $exists: false },
            },
          ],
        },
        {
          $set: {
            city,
            region,
            country,
            geocoding_status: SensorLocationStatus.Resolved,
          },
        },
      )
      .exec();
  }

  /**
   * Помечает актуальную позицию как не имеющую полного адреса.
   * @param location - ожидающая позиция
   */
  async markNotFound(location: PendingSensorLocation): Promise<void> {
    await this.model
      .updateOne(
        {
          _id: location._id,
          source_record_key: location.source_record_key,
          $or: [
            { geocoding_status: SensorLocationStatus.Pending },
            {
              geocoding_status: SensorLocationStatus.Resolved,
              region: { $exists: false },
            },
          ],
        },
        {
          $set: {
            city: null,
            region: null,
            country: null,
            geocoding_status: SensorLocationStatus.NotFound,
          },
        },
      )
      .exec();
  }

  /** Возвращает уникальные города, сгруппированные по странам и регионам. */
  async getCitiesGrouped(): Promise<Record<string, Record<string, string[]>>> {
    const groups = await this.model
      .aggregate<{
        _id: { country: string; region: string };
        cities: string[];
      }>([
        {
          $match: {
            geocoding_status: SensorLocationStatus.Resolved,
            city: { $type: 'string', $ne: '' },
            region: { $type: 'string' },
            country: { $type: 'string', $ne: '' },
          },
        },
        {
          $group: {
            _id: { country: '$country', region: '$region' },
            cities: { $addToSet: '$city' },
          },
        },
        { $sort: { '_id.country': 1, '_id.region': 1 } },
      ])
      .exec();

    const result: Record<string, Record<string, string[]>> = {};
    for (const group of groups) {
      result[group._id.country] ??= {};
      result[group._id.country][group._id.region] = group.cities.sort();
    }
    return result;
  }

  /**
   * Возвращает идентификаторы сенсоров с актуальной разрешённой локацией
   * в указанном городе.
   * @param city - точное название города
   * @returns уникальные идентификаторы сенсоров
   */
  async findSensorIdsByCity(city: string): Promise<string[]> {
    const locations = await this.model
      .find(
        {
          geocoding_status: SensorLocationStatus.Resolved,
          city,
        },
        { _id: 0, sensor_id: 1 },
      )
      .sort({ sensor_id: 1 })
      .lean<Array<{ sensor_id: string }>>()
      .exec();

    return locations.map((location) => location.sensor_id);
  }
}
