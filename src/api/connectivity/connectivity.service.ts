import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import {
  type ConnectivityMessageRecord,
  type ConnectivityPublicFilterQuery,
  ConnectivityRecordRepository,
} from '../../database/repositories/connectivity-record.repository.js';
import {
  decodeConnectivityCursor,
  encodeConnectivityCursor,
  InvalidConnectivityCursorError,
} from './connectivity-cursor.js';
import type { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
import type { ConnectivityMessageFilterQueryDto } from './dto/connectivity-message-filter-query.dto.js';
import type { ConnectivityMessageListQueryDto } from './dto/connectivity-message-list-query.dto.js';

const MAX_RANGE_MILLISECONDS = 24 * 60 * 60 * 1000;

export interface ConnectivitySignedEnvelopeJson {
  readonly sensorId: string;
  readonly timestamp: string;
  readonly nonce: string;
  readonly message: Record<string, unknown>;
  readonly signature: string;
}

export interface ConnectivityMessagePage {
  readonly items: ConnectivitySignedEnvelopeJson[];
  readonly next_cursor: string | null;
}

export interface ConnectivityLatestMessages {
  readonly items: ConnectivitySignedEnvelopeJson[];
}

/** Формирует JSON-выдачу подписанных сообщений Connectivity Protocol. */
@Injectable()
export class ConnectivityService {
  private readonly ss58Prefix: number;

  /** Создаёт API-сервис с repository и ограничением временного диапазона. */
  constructor(
    private readonly recordRepo: ConnectivityRecordRepository,
    private readonly config: ConfigService,
  ) {
    this.ss58Prefix = config.get<number>('cps.ownerSs58Prefix', 32);
  }

  /**
   * Возвращает страницу валидных protocol messages по публичным фильтрам.
   * @param query - проверенные query-параметры endpoint
   * @returns элементы и cursor следующей страницы
   */
  async getMessages(
    query: ConnectivityMessageListQueryDto,
  ): Promise<ConnectivityMessagePage> {
    this.assertOptionalDateRange(query.start, query.end);
    const filter = this.toPublicFilterQuery(query);
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
      ...(cursor ? { cursor } : {}),
    });

    const pageRecords = records.slice(0, query.limit);
    const lastRecord = pageRecords.at(-1);
    return {
      items: pageRecords.map((record) => this.toEnvelopeJson(record)),
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
  async getLatestMessages(
    query: ConnectivityLatestMessageQueryDto,
  ): Promise<ConnectivityLatestMessages> {
    this.assertBoundedDateRange(query.start, query.end);
    const filter = this.toPublicFilterQuery(query);
    const records = await this.recordRepo.findLatestMessages({
      ...filter,
      start: new Date(query.start),
      end: new Date(query.end),
    });
    return { items: records.map((record) => this.toEnvelopeJson(record)) };
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

  /** Преобразует общие API-поля в repository-фильтр. */
  private toPublicFilterQuery(
    query: ConnectivityMessageFilterQueryDto & {
      readonly start?: number;
      readonly end?: number;
    },
  ): ConnectivityPublicFilterQuery {
    return {
      ...(query.start !== undefined ? { start: new Date(query.start) } : {}),
      ...(query.end !== undefined ? { end: new Date(query.end) } : {}),
      ...(query.sensor_id ? { sensorId: query.sensor_id } : {}),
      ...(query.owner ? { owner: query.owner } : {}),
      ...(query.payload_type ? { payloadType: query.payload_type } : {}),
      ...(query.measurement_type
        ? { measurementType: query.measurement_type }
        : {}),
    };
  }

  /** Создаёт JSON SignedEnvelope с декодированным core.v1.Message. */
  private toEnvelopeJson(
    record: ConnectivityMessageRecord,
  ): ConnectivitySignedEnvelopeJson {
    return {
      sensorId: encodeAddress(record.sensor_id_raw, this.ss58Prefix),
      timestamp: record.timestamp_ms.toString(),
      nonce: record.nonce.toString('base64'),
      message: record.message_json,
      signature: record.signature.toString('base64'),
    };
  }
}
