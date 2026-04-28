import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import iconv from 'iconv-lite';
import { Types } from 'mongoose';
import { DatalogStatus } from '../common/constants/datalog-status.enum.js';
import { DatalogRepository } from '../database/repositories/datalog.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import { SensorRepository } from '../database/repositories/sensor.repository.js';
import type { DatalogDocument } from '../database/schemas/datalog.schema.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';

interface RawSensorEntry {
  model?: number;
  geo?: string;
  donated_by?: string;
  measurements?: RawReading[];
}

interface RawReading {
  geo?: string;
  timestamp?: number;
  [key: string]: unknown;
}

interface RawMessageEntry {
  message: string;
  model?: number;
  geo?: string;
  timestamp?: number;
  sensor_id?: string;
  username?: string;
  donated_by?: string;
  images?: string[];
  type?: number;
}

@Injectable()
export class MeasurementProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(MeasurementProcessorService.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    private readonly ipfsFetcher: IpfsFetcherService,
    private readonly datalogRepo: DatalogRepository,
    private readonly measurementRepo: MeasurementRepository,
    private readonly sensorRepo: SensorRepository,
  ) {}

  onModuleInit(): void {
    const interval = this.config.get<number>('ipfs.pollInterval')!;
    this.logger.log(`Starting IPFS poll every ${interval}ms`);
    this.timer = setInterval(() => {
      this.poll().catch((err) =>
        this.logger.error('Poll error', err instanceof Error ? err.stack : err),
      );
    }, interval);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  private async poll(): Promise<void> {
    const pending = await this.datalogRepo.findPending(20);

    if (pending.length === 0) return;
    this.logger.debug(`Processing ${pending.length} pending IPFS records`);

    for (const doc of pending) {
      await this.processOne(doc);
    }
  }

  private async processOne(doc: DatalogDocument): Promise<void> {
    try {
      const data: unknown = this.isIpfsCid(doc.resultHash)
        ? await this.ipfsFetcher.fetch(
            this.resolveIpfsPath(doc.sender, doc.resultHash),
          )
        : JSON.parse(doc.resultHash);

      const measurements = this.isMessageData(data)
        ? this.parseMessageData(
            data as RawMessageEntry,
            doc._id,
            doc.resultHash,
          )
        : this.parseSensorData(data as Record<string, RawSensorEntry>, doc._id);

      if (measurements.length > 0) {
        await this.measurementRepo.insertManyIgnoreDuplicates(measurements);
        await this.upsertSensors(measurements);
      }

      await this.datalogRepo.updateStatus(doc._id, DatalogStatus.PROCESSED);

      this.logger.debug(
        `Block ${doc.block} — processed CID ${doc.resultHash}: ${measurements.length} measurement(s)`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `Block ${doc.block} — failed to process ${doc.resultHash}: ${message}`,
      );

      await this.datalogRepo.updateStatus(
        doc._id,
        DatalogStatus.ERROR,
        message,
      );
    }
  }

  /**
   * Проверяет, является ли строка IPFS CID (v0: Qm..., v1: bafy...).
   * Если строка начинается с `{` — это inline JSON, а не CID.
   */
  private isIpfsCid(value: string): boolean {
    return !value.startsWith('{');
  }

  /**
   * Определяет IPFS-путь для загрузки данных.
   * Для особого sender результат — директория, данные лежат в data.json.
   * @param sender - адрес отправителя datalog
   * @param resultHash - CID из datalog
   */
  private resolveIpfsPath(sender: string, resultHash: string): string {
    const dirSender = this.config.get<string>('ipfs.dirSender', '');
    if (dirSender && sender === dirSender) {
      return `${resultHash}/data.json`;
    }
    return resultHash;
  }

  /**
   * Дедуплицирует сенсоры по sensor_id и выполняет bulkWrite upsert.
   * Обновляет geo при каждом вызове, city/state/country устанавливаются
   * в null только при создании (маркер для геокодирования).
   */
  private async upsertSensors(
    measurements: Array<{
      sensor_id: string;
      geo: { lat: number; lng: number };
    }>,
  ): Promise<void> {
    const unique = new Map<string, { lat: number; lng: number }>();
    for (const m of measurements) {
      unique.set(m.sensor_id, m.geo);
    }

    await this.sensorRepo.bulkUpsert(Array.from(unique));
  }

  private parseGeo(raw: string): { lat: number; lng: number } | null {
    const parts = raw.split(',');
    if (parts.length !== 2) return null;
    const lat = parseFloat(parts[0]);
    const lng = parseFloat(parts[1]);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  }

  /**
   * Проверяет, содержит ли объект данных поле message (формат сообщения).
   */
  private isMessageData(data: unknown): boolean {
    return (
      data != null &&
      typeof data === 'object' &&
      'message' in (data as Record<string, unknown>)
    );
  }

  private static readonly DEFAULT_MESSAGE_SENSOR_ID =
    'd32ac7ffaea820d67822f0b9523a2e004abefda646466a92db1bbf7fcb78fa51';

  /**
   * Подготавливает данные из формата с полем message.
   * @param data - объект с message, model, geo, timestamp и т.д.
   * @param datalogId - ObjectId записи datalog
   * @param resultHash - оригинальный resultHash для сохранения в ipfs
   */
  private parseMessageData(
    data: RawMessageEntry,
    datalogId: Types.ObjectId,
    resultHash: string,
  ) {
    if (data.model == null || !data.geo || !data.timestamp) {
      this.logger.debug(
        'Skipping message entry: missing model, geo or timestamp',
      );
      return [];
    }

    const geo = this.parseGeo(data.geo);
    if (!geo) {
      this.logger.debug('Skipping message entry: invalid geo');
      return [];
    }

    return [
      {
        datalog_id: datalogId,
        sensor_id:
          data.sensor_id ||
          MeasurementProcessorService.DEFAULT_MESSAGE_SENSOR_ID,
        model: data.model,
        measurement: {
          username: data.username ?? '',
          message: iconv.decode(Buffer.from(data.message), 'utf8'),
          timestamp: data.timestamp,
          ipfs: resultHash,
          images: data.images ?? [],
          type: data.type ?? 0,
        },
        geo,
        donated_by: data.donated_by || undefined,
        timestamp: data.timestamp,
      },
    ];
  }

  private parseSensorData(
    data: Record<string, RawSensorEntry>,
    datalogId: Types.ObjectId,
  ) {
    const results: Array<{
      datalog_id: Types.ObjectId;
      sensor_id: string;
      model: number;
      measurement: Record<string, unknown>;
      geo: { lat: number; lng: number };
      donated_by?: string;
      timestamp: number;
    }> = [];

    const seen = new Set<string>();

    for (const [sensorId, entry] of Object.entries(data)) {
      if (entry.model == null || !Array.isArray(entry.measurements)) {
        this.logger.debug(
          `Skipping sensor ${sensorId}: missing model or measurements`,
        );
        continue;
      }

      const topGeo = entry.geo ? this.parseGeo(entry.geo) : null;

      for (const reading of entry.measurements) {
        const geo = reading.geo ? this.parseGeo(reading.geo) : topGeo;
        if (!geo) {
          this.logger.debug(`Skipping reading for ${sensorId}: missing geo`);
          continue;
        }

        // Build measurement object: exclude timestamp/geo, lowercase keys, numeric values
        const { timestamp: ts, geo: _omitGeo, ...rawFields } = reading;
        void _omitGeo;
        const measurementFields: Record<string, number> = {};
        for (const [key, val] of Object.entries(rawFields)) {
          measurementFields[key.toLowerCase()] = Number(val);
        }

        const timestamp = ts ?? 0;

        const dedupKey = `${sensorId}:${timestamp}`;
        if (seen.has(dedupKey)) {
          this.logger.debug(
            `Skipping duplicate for ${sensorId} at ${timestamp}`,
          );
          continue;
        }
        seen.add(dedupKey);

        results.push({
          datalog_id: datalogId,
          sensor_id: sensorId,
          model: entry.model,
          measurement: measurementFields,
          geo,
          donated_by: entry.donated_by || undefined,
          timestamp,
        });
      }
    }

    return results;
  }
}
