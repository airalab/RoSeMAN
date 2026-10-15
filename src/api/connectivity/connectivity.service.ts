import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { create, toBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
import { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import { normalizeCpsNodeId } from '../../common/utils/cps-node-id.util.js';
import {
  type ConnectivityCsvRecord,
  type ConnectivityMessageRecord,
  type ConnectivityPublicFilterQuery,
  ConnectivityRecordRepository,
} from '../../database/repositories/connectivity-record.repository.js';
import { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import { SensorLocationRepository } from '../../database/repositories/sensor-location.repository.js';
import {
  decodeConnectivityCursor,
  encodeConnectivityCursor,
  InvalidConnectivityCursorError,
} from './connectivity-cursor.js';
import type { ConnectivityCsvQueryDto } from './dto/connectivity-csv-query.dto.js';
import type { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
import type { ConnectivityMaxMessageQueryDto } from './dto/connectivity-max-message-query.dto.js';
import type { ConnectivityMessageBaseFilterQueryDto } from './dto/connectivity-message-filter-query.dto.js';
import type { ConnectivityMessageListQueryDto } from './dto/connectivity-message-list-query.dto.js';

const MAX_RANGE_MILLISECONDS = 24 * 60 * 60 * 1000;
const MAX_CSV_RANGE_MILLISECONDS = 31 * 24 * 60 * 60 * 1000;
const CSV_REQUIRED_MEASUREMENTS = ['pm10', 'pm25'] as const;

const KNOWN_CSV_MEASUREMENTS: Readonly<
  Record<string, { readonly field: string; readonly divisor: number }>
> = {
  temperature: { field: 'centiCelsius', divisor: 100 },
  humidity: { field: 'centiPercent', divisor: 100 },
  pressure: { field: 'deciPascal', divisor: 10 },
  co2: { field: 'ppm', divisor: 1 },
  pm25: { field: 'deciUgM3', divisor: 10 },
  pm10: { field: 'deciUgM3', divisor: 10 },
  noiseMax: { field: 'db', divisor: 1 },
  noiseAvg: { field: 'db', divisor: 1 },
};

interface ConnectivityCsvRow {
  readonly timestamp: Date;
  readonly sensorId: string;
  readonly geo?: { readonly lat: number; readonly lng: number };
  readonly measurements: Record<string, number>;
}

interface NumericLeaf {
  readonly path: string;
  readonly value: number;
}

/** Проверяет, что значение является обычным JSON-объектом. */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Собирает конечные числовые листья JSON-объекта с устойчивыми путями.
 * @param value - произвольное значение protobuf JSON
 * @param path - накопленный путь внутри значения
 * @returns найденные числовые листья
 */
function collectNumericLeaves(value: unknown, path = ''): NumericLeaf[] {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return [{ path, value }];
  }
  if (!isJsonObject(value)) return [];

  return Object.entries(value).flatMap(([key, nested]) =>
    collectNumericLeaves(nested, path ? `${path}.${key}` : key),
  );
}

/** Форматирует время CSV-строки в UTC-формате legacy API. */
function formatCsvTimestamp(timestamp: Date): string {
  return (
    [
      String(timestamp.getUTCDate()).padStart(2, '0'),
      String(timestamp.getUTCMonth() + 1).padStart(2, '0'),
      timestamp.getUTCFullYear(),
    ].join('.') +
    ' ' +
    [
      String(timestamp.getUTCHours()).padStart(2, '0'),
      String(timestamp.getUTCMinutes()).padStart(2, '0'),
    ].join(':')
  );
}

export interface ConnectivityMessageJsonResponse {
  readonly sensorId: string;
  readonly message: Record<string, unknown>;
}

export interface ConnectivityMessagePage {
  readonly items: ConnectivityMessageJsonResponse[];
  readonly next_cursor: string | null;
}

export interface ConnectivityLatestMessages {
  readonly items: ConnectivityMessageJsonResponse[];
}

export interface ConnectivityMaxMessages {
  readonly items: ConnectivityMessageJsonResponse[];
}

/** Обслуживает публичные выборки Connectivity Protocol и связей сенсоров. */
@Injectable()
export class ConnectivityService {
  private readonly ss58Prefix: number;

  /** Создаёт API-сервис с repository и ограничением временного диапазона. */
  constructor(
    private readonly recordRepo: ConnectivityRecordRepository,
    private readonly anchorRepo: CpsAnchorRepository,
    private readonly sensorLocationRepo: SensorLocationRepository,
    private readonly config: ConfigService,
  ) {
    this.ss58Prefix = config.get<number>('cps.sensorSs58Prefix', 32);
  }

  /**
   * Возвращает отсортированные идентификаторы сенсоров текущего владельца.
   * Владелец определяется по CPS-якорю самой свежей канонической записи.
   * @param owner - адрес владельца
   * @returns уникальные идентификаторы сенсоров владельца
   */
  async getSensorIdsByOwner(owner: string): Promise<string[]> {
    return this.anchorRepo.findCurrentSensorIdsByOwner(owner);
  }

  /** Возвращает уникальные CPS-города по странам и регионам. */
  async getCities(): Promise<Record<string, Record<string, string[]>>> {
    return this.sensorLocationRepo.getCitiesGrouped();
  }

  /**
   * Возвращает TSV-файл с публичными CPS-показаниями сенсоров города.
   * @param query - город и обязательный временной диапазон в миллисекундах
   * @returns содержимое совместимого CSV-файла
   */
  async getMessagesCsv(query: ConnectivityCsvQueryDto): Promise<string> {
    this.assertCsvDateRange(query.start, query.end);
    const sensorIds = await this.sensorLocationRepo.findSensorIdsByCity(
      query.city,
    );
    const records = await this.recordRepo.findCsvRecords({
      sensorIds,
      start: new Date(query.start),
      end: new Date(query.end),
    });
    const rows = records
      .map((record) => this.toCsvRow(record))
      .filter((row): row is ConnectivityCsvRow => row !== null);

    const extraMeasurements = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row.measurements)) {
        if (!CSV_REQUIRED_MEASUREMENTS.includes(key as 'pm10' | 'pm25')) {
          extraMeasurements.add(key);
        }
      }
    }
    const measurementColumns = [
      ...CSV_REQUIRED_MEASUREMENTS,
      ...[...extraMeasurements].sort(),
    ];
    const header = [
      'timestamp',
      'sensor_id',
      'geo',
      ...measurementColumns,
    ].join('\t');
    const csvRows = rows.map((row) =>
      [
        formatCsvTimestamp(row.timestamp),
        row.sensorId,
        row.geo ? JSON.stringify(row.geo) : '',
        ...measurementColumns.map((key) => row.measurements[key] ?? ''),
      ].join('\t'),
    );

    return [header, ...csvRows].join('\n');
  }

  /**
   * Возвращает страницу валидных protocol messages по публичным фильтрам.
   * @param query - проверенные query-параметры endpoint
   * @returns элементы и cursor следующей страницы
   */
  async getMessagesJson(
    query: ConnectivityMessageListQueryDto,
  ): Promise<ConnectivityMessagePage> {
    const page = await this.getMessageRecords(query);
    return {
      items: page.items.map((record) => this.toEnvelopeJson(record)),
      next_cursor: page.next_cursor,
    };
  }

  /**
   * Возвращает protobuf batch страницы с исходными подписанными полями.
   * @param query - проверенные query-параметры списка сообщений
   * @returns бинарный SignedEnvelopeBatch и cursor следующей страницы
   */
  async getMessagesProtobuf(
    query: ConnectivityMessageListQueryDto,
  ): Promise<{ bytes: Buffer; next_cursor: string | null }> {
    const page = await this.getMessageRecords(query, true);
    return {
      bytes: this.toEnvelopeBatch(page.items),
      next_cursor: page.next_cursor,
    };
  }

  /**
   * Выбирает одну и ту же страницу записей для обоих форматов ответа.
   * @param query - проверенные query-параметры списка сообщений
   * @param includeMessageRaw - нужно ли загружать исходные байты message
   * @returns записи страницы и cursor следующей страницы
   */
  private async getMessageRecords(
    query: ConnectivityMessageListQueryDto,
    includeMessageRaw = false,
  ): Promise<{
    items: ConnectivityMessageRecord[];
    next_cursor: string | null;
  }> {
    this.assertOptionalDateRange(query.start, query.end);
    const filter = this.toPublicFilterQuery(query, query.type);
    let cursor;
    try {
      cursor = query.cursor
        ? decodeConnectivityCursor(query.cursor)
        : undefined;
    } catch (error) {
      if (error instanceof InvalidConnectivityCursorError) {
        throw new BadRequestException('Invalid cursor');
      }
      throw error;
    }

    const records = await this.recordRepo.findMessagePage({
      ...filter,
      limit: query.limit,
      ...(includeMessageRaw ? { includeMessageRaw: true } : {}),
      ...(cursor ? { cursor } : {}),
    });

    const pageRecords = records.slice(0, query.limit);
    const lastRecord = pageRecords.at(-1);
    return {
      items: pageRecords,
      next_cursor:
        records.length > query.limit && lastRecord
          ? encodeConnectivityCursor({
              recordedAt: lastRecord.recorded_at,
              recordId: lastRecord._id,
            })
          : null,
    };
  }

  /**
   * Возвращает самое новое валидное сообщение каждого сенсора в диапазоне.
   * @param query - проверенные границы дат и необязательные фильтры
   * @returns элементы SignedEnvelope без pagination metadata
   */
  async getLatestMessagesJson(
    query: ConnectivityLatestMessageQueryDto,
  ): Promise<ConnectivityLatestMessages> {
    const records = await this.getLatestMessageRecords(query);
    return { items: records.map((record) => this.toEnvelopeJson(record)) };
  }

  /**
   * Возвращает protobuf batch последних сообщений сенсоров.
   * @param query - проверенные границы дат и необязательные фильтры
   * @returns бинарный SignedEnvelopeBatch последних сообщений
   */
  async getLatestMessagesProtobuf(
    query: ConnectivityLatestMessageQueryDto,
  ): Promise<Buffer> {
    return this.toEnvelopeBatch(
      await this.getLatestMessageRecords(query, true),
    );
  }

  /**
   * Возвращает сообщение с максимальным показателем для каждого сенсора.
   * @param query - проверенный диапазон, тип показателя и фильтры
   * @returns элементы, отсортированные по максимальному значению убывающе
   */
  async getMaxMessagesJson(
    query: ConnectivityMaxMessageQueryDto,
  ): Promise<ConnectivityMaxMessages> {
    const records = await this.getMaxMessageRecords(query);
    return { items: records.map((record) => this.toEnvelopeJson(record)) };
  }

  /**
   * Возвращает protobuf batch сообщений с максимальными показателями.
   * @param query - проверенный диапазон, тип показателя и фильтры
   * @returns бинарный SignedEnvelopeBatch
   */
  async getMaxMessagesProtobuf(
    query: ConnectivityMaxMessageQueryDto,
  ): Promise<Buffer> {
    return this.toEnvelopeBatch(await this.getMaxMessageRecords(query, true));
  }

  /**
   * Выбирает последние записи с общими фильтрами и проверкой диапазона.
   * @param query - проверенные границы дат и необязательные фильтры
   * @param includeMessageRaw - нужно ли загружать исходные байты message
   * @returns последние записи каждого сенсора в заданном диапазоне
   */
  private async getLatestMessageRecords(
    query: ConnectivityLatestMessageQueryDto,
    includeMessageRaw = false,
  ): Promise<ConnectivityMessageRecord[]> {
    this.assertBoundedDateRange(query.start, query.end);
    const filter = this.toPublicFilterQuery(query, query.type);
    return this.recordRepo.findLatestMessages({
      ...filter,
      ...(includeMessageRaw ? { includeMessageRaw: true } : {}),
      start: new Date(query.start),
      end: new Date(query.end),
    });
  }

  /**
   * Выбирает максимальные записи с общими фильтрами и проверкой диапазона.
   * @param query - проверенный диапазон, тип показателя и фильтры
   * @param includeMessageRaw - нужно ли загружать исходные байты message
   * @returns максимальные записи каждого сенсора
   */
  private async getMaxMessageRecords(
    query: ConnectivityMaxMessageQueryDto,
    includeMessageRaw = false,
  ): Promise<ConnectivityMessageRecord[]> {
    this.assertBoundedDateRange(query.start, query.end);
    const filter = this.toPublicFilterQuery(query);
    return this.recordRepo.findMaxMessages({
      ...filter,
      ...(includeMessageRaw ? { includeMessageRaw: true } : {}),
      start: new Date(query.start),
      end: new Date(query.end),
      type: query.type,
    });
  }

  /**
   * Кодирует только внешние конверты, сохраняя message_raw побайтно.
   * @param records - валидные записи с исходными полями SignedEnvelope
   * @returns бинарное представление protobuf SignedEnvelopeBatch
   */
  private toEnvelopeBatch(
    records: readonly ConnectivityMessageRecord[],
  ): Buffer {
    const batch = create(SignedEnvelopeBatchSchema, {
      batch: records.map((record) => {
        if (!record.message_raw?.length) {
          throw new InternalServerErrorException(
            'Raw message bytes unavailable',
          );
        }
        return {
          sensorId: record.sensor_id_raw,
          nonce: record.nonce,
          message: record.message_raw,
          signature: record.signature,
        };
      }),
    });
    return Buffer.from(toBinary(SignedEnvelopeBatchSchema, batch));
  }

  /** Проверяет порядок двух необязательных границ списка сообщений. */
  private assertOptionalDateRange(start?: number, end?: number): void {
    if (start !== undefined && end !== undefined && start >= end) {
      throw new BadRequestException('start must be less than end');
    }
  }

  /** Требует обе границы и ограничивает диапазон последних сообщений 24 часами. */
  private assertBoundedDateRange(start?: number, end?: number): void {
    if (start === undefined || end === undefined) {
      throw new BadRequestException('start and end are required');
    }
    if (start >= end) {
      throw new BadRequestException('start must be less than end');
    }
    if (end - start > MAX_RANGE_MILLISECONDS) {
      throw new PayloadTooLargeException('Max period 24 hours');
    }
  }

  /** Проверяет обязательный полуоткрытый диапазон CSV не длиннее 31 дня. */
  private assertCsvDateRange(start: number, end: number): void {
    if (start >= end) {
      throw new BadRequestException('start must be less than end');
    }
    if (end - start > MAX_CSV_RANGE_MILLISECONDS) {
      throw new PayloadTooLargeException('Max period 31 days');
    }
  }

  /**
   * Преобразует каноническую CPS-запись в одну строку совместимого CSV.
   * @param record - валидная декодированная запись Connectivity Protocol
   * @returns строка либо null для сообщения без числовых показаний
   */
  private toCsvRow(record: ConnectivityCsvRecord): ConnectivityCsvRow | null {
    const payload = isJsonObject(record.message_json.urban)
      ? record.message_json.urban
      : isJsonObject(record.message_json.insight)
        ? record.message_json.insight
        : null;
    if (!payload || !Array.isArray(payload.public)) return null;

    let geo: ConnectivityCsvRow['geo'];
    const measurements: Record<string, number> = {};
    for (const publicEntry of payload.public) {
      if (!isJsonObject(publicEntry)) continue;
      for (const [sensorType, sensorValue] of Object.entries(publicEntry)) {
        if (!isJsonObject(sensorValue)) continue;
        if (sensorType === 'gps') {
          const lat = sensorValue.lat;
          const lng = sensorValue.lon;
          if (
            typeof lat === 'number' &&
            Number.isFinite(lat) &&
            lat >= -90 &&
            lat <= 90 &&
            typeof lng === 'number' &&
            Number.isFinite(lng) &&
            lng >= -180 &&
            lng <= 180
          ) {
            geo = { lat, lng };
          }
          continue;
        }

        for (const [measurementType, measurementValue] of Object.entries(
          sensorValue,
        )) {
          this.appendCsvMeasurement(
            measurements,
            measurementType,
            measurementValue,
          );
        }
      }
    }
    if (Object.keys(measurements).length === 0) return null;

    return {
      timestamp: record.recorded_at,
      sensorId: encodeAddress(
        Buffer.from(record.sensor_id, 'hex'),
        this.ss58Prefix,
      ),
      ...(geo ? { geo } : {}),
      measurements,
    };
  }

  /**
   * Добавляет известное нормализованное либо произвольное числовое показание.
   * @param target - итоговая карта CSV-показаний
   * @param measurementType - имя protobuf oneof измерения
   * @param value - protobuf JSON-значение измерения
   */
  private appendCsvMeasurement(
    target: Record<string, number>,
    measurementType: string,
    value: unknown,
  ): void {
    const known = KNOWN_CSV_MEASUREMENTS[measurementType];
    if (known && isJsonObject(value)) {
      const rawValue = value[known.field];
      if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
        const column =
          measurementType === 'noiseMax'
            ? 'noise_max'
            : measurementType === 'noiseAvg'
              ? 'noise_avg'
              : measurementType;
        target[column] = rawValue / known.divisor;
        return;
      }
    }

    const leaves = collectNumericLeaves(value);
    if (leaves.length === 1) {
      target[measurementType] = leaves[0].value;
      return;
    }
    for (const leaf of leaves) {
      target[`${measurementType}.${leaf.path}`] = leaf.value;
    }
  }

  /** Преобразует общие API-поля в repository-фильтр. */
  private toPublicFilterQuery(
    query: ConnectivityMessageBaseFilterQueryDto & {
      readonly start?: number;
      readonly end?: number;
    },
    measurementType?: string,
  ): ConnectivityPublicFilterQuery {
    return {
      ...(query.start !== undefined ? { start: new Date(query.start) } : {}),
      ...(query.end !== undefined ? { end: new Date(query.end) } : {}),
      ...(query.sensor_id ? { sensorId: query.sensor_id } : {}),
      ...(query.node_id ? { nodeId: this.normalizeNodeId(query.node_id) } : {}),
      ...(query.payload_type ? { payloadType: query.payload_type } : {}),
      ...(measurementType ? { measurementType } : {}),
    };
  }

  /**
   * Создаёт публичное JSON-представление сообщения без nonce и signature.
   * @param record - валидная запись Connectivity Protocol
   * @returns идентификатор сенсора и декодированное core.v1.Message
   */
  private toEnvelopeJson(
    record: ConnectivityMessageRecord,
  ): ConnectivityMessageJsonResponse {
    return {
      sensorId: encodeAddress(record.sensor_id_raw, this.ss58Prefix),
      message: record.message_json,
    };
  }

  /**
   * Проверяет и канонизирует публичный фильтр CPS NodeId.
   * @param nodeId - значение query-параметра в десятичной форме
   * @returns каноническая uint64-строка
   */
  private normalizeNodeId(nodeId: string): string {
    try {
      return normalizeCpsNodeId(nodeId);
    } catch {
      throw new BadRequestException('Invalid node_id');
    }
  }
}
