import { Injectable } from '@nestjs/common';
import {
  MeasurementRepository,
  type SensorListEntry,
} from '../../database/repositories/measurement.repository.js';
import { SensorRepository } from '../../database/repositories/sensor.repository.js';
import { SubscriptionRepository } from '../../database/repositories/subscription.repository.js';
import { type GeoBound } from './dto/sensor-json-query.dto.js';

interface MaxDataEntry {
  model: number;
  geo: { lat: number; lng: number };
  timestamp: number;
  value: number;
}

interface SensorListItem extends SensorListEntry {
  owner?: string;
}

/**
 * Сервис для агрегации данных сенсоров.
 */
@Injectable()
export class SensorService {
  constructor(
    private readonly measurementRepo: MeasurementRepository,
    private readonly sensorRepo: SensorRepository,
    private readonly subscriptionRepo: SubscriptionRepository,
  ) {}

  /**
   * Возвращает максимальное значение измерения заданного типа
   * для каждого сенсора в указанном временном диапазоне.
   * @param type - тип измерения (например `pm10`)
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   * @returns объект вида `{ [sensor_id]: { model, geo, timestamp, value } }`
   */
  async getMaxData(
    type: string,
    start: number,
    end: number,
  ): Promise<Record<string, MaxDataEntry>> {
    const docs = await this.measurementRepo.getMaxByType(type, start, end);

    const result: Record<string, MaxDataEntry> = {};
    for (const doc of docs) {
      result[doc._id] = {
        model: doc.model,
        geo: doc.geo,
        timestamp: doc.timestamp,
        value: doc.value,
      };
    }

    return result;
  }

  /**
   * Возвращает список сенсоров, имеющих данные в указанном временном диапазоне.
   * Для сенсоров с подпиской добавляет поле owner.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getSensorList(start: number, end: number): Promise<SensorListItem[]> {
    const sensors = await this.measurementRepo.findSensorsInRange(start, end);
    return this.attachOwners(sensors);
  }

  /**
   * Возвращает список сенсоров без измерений co2 за указанный временной диапазон.
   * Для сенсоров с подпиской добавляет поле owner.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getUrbanSensorList(
    start: number,
    end: number,
  ): Promise<SensorListItem[]> {
    const sensors = await this.measurementRepo.findUrbanSensorsInRange(
      start,
      end,
    );
    return this.attachOwners(sensors);
  }

  /**
   * Добавляет поле owner к сенсорам, у которых есть подписка.
   * @param sensors - список сенсоров
   */
  private async attachOwners(
    sensors: SensorListEntry[],
  ): Promise<SensorListItem[]> {
    if (sensors.length === 0) return [];

    const sensorIds = sensors.map((s) => s.sensor_id);
    const ownerMap =
      await this.subscriptionRepo.findOwnersByAccounts(sensorIds);

    return sensors.map((sensor) => {
      const owner = ownerMap.get(sensor.sensor_id);
      return owner ? { ...sensor, owner } : sensor;
    });
  }

  /**
   * Возвращает список городов, сгруппированных по странам и регионам.
   */
  async getCitiesGrouped(): Promise<Record<string, Record<string, string[]>>> {
    return this.sensorRepo.getCitiesGrouped();
  }

  /**
   * Возвращает уникальные типы измерений за указанный временной диапазон.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getMeasurementTypes(start: number, end: number): Promise<string[]> {
    return this.measurementRepo.getDistinctMeasurementTypes(start, end);
  }

  /**
   * Возвращает измерения конкретного сенсора за указанный временной диапазон.
   * @param sensorId - идентификатор сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  /**
   * Возвращает измерения из указанной области (bound или city)
   * за временной диапазон, сгруппированные по sensor_id.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   * @param options - geo-bound или название города
   */
  async getSensorJson(
    start: number,
    end: number,
    options: { bound?: GeoBound; city?: string },
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
    if (options.bound) {
      return this.measurementRepo.findGroupedByArea(start, end, {
        bound: options.bound,
      });
    }

    const sensorIds = await this.sensorRepo.findSensorIdsByCity(options.city!);

    if (sensorIds.length === 0) {
      return {};
    }

    return this.measurementRepo.findGroupedByArea(start, end, { sensorIds });
  }

  /**
   * Возвращает CSV-строку с данными сенсоров указанного города
   * за временной диапазон.
   * Заголовки: timestamp, sensor_id, geo, pm10, pm25, + динамические ключи measurement.
   * Разделитель — табуляция.
   * @param city - название города
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getSensorCsv(
    city: string,
    start: number,
    end: number,
  ): Promise<string> {
    const sensorIds = await this.sensorRepo.findSensorIdsByCity(city);

    if (sensorIds.length === 0) {
      return 'timestamp\tsensor_id\tgeo\tpm10\tpm25';
    }

    const docs = await this.measurementRepo.findFlatBySensorIds(
      sensorIds,
      start,
      end,
    );

    if (docs.length === 0) {
      return 'timestamp\tsensor_id\tgeo\tpm10\tpm25';
    }

    const requiredKeys = ['pm10', 'pm25'];
    const extraKeysSet = new Set<string>();

    for (const doc of docs) {
      for (const key of Object.keys(doc.measurement)) {
        if (!requiredKeys.includes(key)) {
          extraKeysSet.add(key);
        }
      }
    }

    const extraKeys = [...extraKeysSet].sort();
    const allMeasurementKeys = [...requiredKeys, ...extraKeys];
    const header = [
      'timestamp',
      'sensor_id',
      'geo',
      ...allMeasurementKeys,
    ].join('\t');

    const rows = docs.map((doc) => {
      const date = new Date(doc.timestamp * 1000);
      const formattedDate =
        [
          String(date.getUTCDate()).padStart(2, '0'),
          String(date.getUTCMonth() + 1).padStart(2, '0'),
          date.getUTCFullYear(),
        ].join('.') +
        ' ' +
        [
          String(date.getUTCHours()).padStart(2, '0'),
          String(date.getUTCMinutes()).padStart(2, '0'),
        ].join(':');

      const geo = JSON.stringify(doc.geo);
      const values = allMeasurementKeys.map((key) => {
        const v = doc.measurement[key];
        if (v == null) return '';
        return typeof v === 'object' ? JSON.stringify(v) : String(v as number);
      });

      return [formattedDate, doc.sensor_id, geo, ...values].join('\t');
    });

    return [header, ...rows].join('\n');
  }

  /**
   * Возвращает сообщения (model === MESSAGE) за указанный временной диапазон.
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getMessages(
    start: number,
    end: number,
  ): Promise<
    Array<{
      id: string;
      message: string;
      timestamp: number;
      geo: { lat: number; lng: number };
      author: string;
      images: string[];
    }>
  > {
    const docs = await this.measurementRepo.findMessages(start, end);

    return docs.map((doc) => ({
      id: doc.sensor_id,
      message:
        typeof doc.measurement.message === 'string'
          ? doc.measurement.message
          : '',
      timestamp: doc.timestamp,
      geo: doc.geo,
      author:
        typeof doc.measurement.username === 'string'
          ? doc.measurement.username
          : '',
      images: Array.isArray(doc.measurement.images)
        ? (doc.measurement.images as string[])
        : [],
    }));
  }

  async getSensorData(
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
    return this.measurementRepo.findBySensorInRange(sensorId, start, end);
  }

  /**
   * Возвращает данные сенсора за период, а также данные всех сенсоров того же owner.
   * Если у сенсора нет owner — возвращает только data основного сенсора.
   * @param sensorId - идентификатор запрашиваемого сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getSensorDataWithOwner(
    sensorId: string,
    start: number,
    end: number,
  ): Promise<{
    result: Array<{
      data: Record<string, unknown>;
      timestamp: number;
      geo: { lat: number; lng: number };
    }>;
    sensor: {
      owner: string;
      sensors: string[];
      data: Record<
        string,
        Array<{
          data: Record<string, unknown>;
          timestamp: number;
          geo: { lat: number; lng: number };
        }>
      >;
    } | null;
  }> {
    const result = await this.measurementRepo.findBySensorInRange(
      sensorId,
      start,
      end,
    );

    const ownerMap = await this.subscriptionRepo.findOwnersByAccounts([
      sensorId,
    ]);
    const owner = ownerMap.get(sensorId);

    if (!owner) {
      return { result, sensor: null };
    }

    const sensors = await this.subscriptionRepo.findAccountsByOwner(owner);
    const data: Record<
      string,
      Array<{
        data: Record<string, unknown>;
        timestamp: number;
        geo: { lat: number; lng: number };
      }>
    > = {};

    await Promise.all(
      sensors.map(async (id) => {
        data[id] = await this.measurementRepo.findBySensorInRange(
          id,
          start,
          end,
        );
      }),
    );

    return {
      result,
      sensor: { owner, sensors, data },
    };
  }
}
