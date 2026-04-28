import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type AnyBulkWriteOperation, Model, type Types } from 'mongoose';
import { Sensor, type SensorDocument } from '../schemas/sensor.schema.js';

/**
 * Репозиторий для работы с коллекцией sensor.
 */
@Injectable()
export class SensorRepository {
  constructor(
    @InjectModel(Sensor.name)
    private readonly model: Model<SensorDocument>,
  ) {}

  /**
   * Выполняет bulkWrite upsert для массива сенсоров.
   * Обновляет geo, при создании устанавливает city/state/country в null.
   * @param entries - массив пар [sensor_id, geo]
   */
  async bulkUpsert(
    entries: Array<[string, { lat: number; lng: number }]>,
  ): Promise<void> {
    const ops: AnyBulkWriteOperation<Sensor>[] = entries.map(
      ([sensor_id, geo]) => ({
        updateOne: {
          filter: { sensor_id },
          update: {
            $set: { geo },
            $setOnInsert: { sensor_id, city: null, state: null, country: null },
          },
          upsert: true,
        },
      }),
    );

    await this.model.bulkWrite(ops, { ordered: false });
  }

  /**
   * Находит сенсоры без заполненного city (city === null).
   * @param limit - максимальное количество результатов
   */
  async findWithoutCity(limit: number): Promise<SensorDocument[]> {
    return this.model.find({ city: null }).limit(limit).exec();
  }

  /**
   * Обновляет данные о местоположении сенсора.
   * @param id - ObjectId сенсора
   * @param location - объект с city, state, country
   */
  /**
   * Возвращает список городов, сгруппированных по странам и регионам.
   * Исключает сенсоры без заполненного city.
   */
  async getCitiesGrouped(): Promise<Record<string, Record<string, string[]>>> {
    const docs = await this.model
      .aggregate<{ _id: { country: string; state: string }; cities: string[] }>(
        [
          { $match: { city: { $nin: [null, ''] } } },
          {
            $group: {
              _id: { country: '$country', state: '$state' },
              cities: { $addToSet: '$city' },
            },
          },
          { $sort: { '_id.country': 1, '_id.state': 1 } },
        ],
      )
      .exec();

    const result: Record<string, Record<string, string[]>> = {};

    for (const doc of docs) {
      const country = doc._id.country ?? '';
      const state = doc._id.state ?? '';

      if (!result[country]) {
        result[country] = {};
      }

      result[country][state] = doc.cities.sort();
    }

    return result;
  }

  /**
   * Возвращает массив sensor_id для сенсоров в указанном городе.
   * @param city - название города
   */
  async findSensorIdsByCity(city: string): Promise<string[]> {
    const docs = await this.model
      .find({ city }, { _id: 0, sensor_id: 1 })
      .lean()
      .exec();

    return docs.map((d) => d.sensor_id);
  }

  async updateLocation(
    id: Types.ObjectId,
    location: { city: string; state: string; country: string },
  ): Promise<void> {
    await this.model.updateOne({ _id: id }, { $set: location });
  }
}
