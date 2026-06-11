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

/** Элемент списка маркеров: запись с device_model и опциональным owner. */
interface MarkerSensorItem extends SensorListEntry {
  device_model: string;
  owner?: string;
}

/** Признак insight-сенсора по полю device_model (регистронезависимо). */
const INSIGHT_REGEX = /insight/i;

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
   * Возвращает список Urban-сенсоров за указанный временной диапазон.
   * Urban-сенсор определяется по полю device_model (содержит "urban"
   * или не указан). Для сенсоров с подпиской добавляет поле owner.
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
   * Возвращает список сенсоров для отображения маркеров за указанный
   * временной диапазон. В результат попадают:
   * 1. все urban-сенсоры (device_model содержит "urban");
   * 2. все сенсоры без указанного device_model;
   * 3. insight-сенсоры, у владельца которых нет ни одного сенсора из
   *    пунктов 1–2 (insight без владельца также включается).
   * Каждый элемент содержит device_model, а если в измерении указан
   * owner — также поле owner. Информация о владельце берётся из поля
   * owner коллекции measurement (не из подписок).
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  async getMarkerSensorList(
    start: number,
    end: number,
  ): Promise<MarkerSensorItem[]> {
    const sensors = await this.measurementRepo.findMarkerSensorsInRange(
      start,
      end,
    );
    if (sensors.length === 0) return [];

    // Владельцы, у которых есть urban-сенсор или сенсор без device_model.
    // Insight-сенсоры таких владельцев в результат не попадают.
    const urbanOwners = new Set<string>();
    for (const sensor of sensors) {
      if (INSIGHT_REGEX.test(sensor.device_model)) continue;
      if (sensor.owner) urbanOwners.add(sensor.owner);
    }

    const result: MarkerSensorItem[] = [];
    for (const sensor of sensors) {
      if (
        INSIGHT_REGEX.test(sensor.device_model) &&
        sensor.owner &&
        urbanOwners.has(sensor.owner)
      ) {
        // insight включаем, только если у его владельца нет urban-сенсора
        continue;
      }

      // owner отдаётся только если он указан в измерении
      const { owner, ...entry } = sensor;
      result.push(owner ? { ...entry, owner } : entry);
    }

    return result;
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
        return typeof v === 'object' ? JSON.stringify(v) : String(v);
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
   * Каждый элемент списка sensors содержит device_model, если он указан у сенсора.
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
      sensors: Array<{ sensor_id: string; device_model?: string }>;
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

    const sensorIds = await this.subscriptionRepo.findAccountsByOwner(owner);
    const data: Record<
      string,
      Array<{
        data: Record<string, unknown>;
        timestamp: number;
        geo: { lat: number; lng: number };
      }>
    > = {};

    const [, deviceModels] = await Promise.all([
      Promise.all(
        sensorIds.map(async (id) => {
          data[id] = await this.measurementRepo.findBySensorInRange(
            id,
            start,
            end,
          );
        }),
      ),
      this.measurementRepo.getDeviceModelsBySensorIds(sensorIds, start, end),
    ]);

    const sensors = sensorIds.map((id) => {
      const deviceModel = deviceModels.get(id);
      return deviceModel !== undefined
        ? { sensor_id: id, device_model: deviceModel }
        : { sensor_id: id };
    });

    return {
      result,
      sensor: { owner, sensors, data },
    };
  }
}
