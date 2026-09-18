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

/** Формирует JSON- и protobuf-выдачу подписанных сообщений Connectivity Protocol. */
@Injectable()
export class ConnectivityService {
  private readonly ss58Prefix: number;

  /** Создаёт API-сервис с repository и ограничением временного диапазона. */
  constructor(
    private readonly recordRepo: ConnectivityRecordRepository,
    private readonly config: ConfigService,
  ) {
    this.ss58Prefix = config.get<number>('cps.sensorSs58Prefix', 32);
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
    const filter = this.toPublicFilterQuery(query);
    return this.recordRepo.findLatestMessages({
      ...filter,
      ...(includeMessageRaw ? { includeMessageRaw: true } : {}),
      start: new Date(query.start),
      end: new Date(query.end),
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
      ...(query.node_id ? { nodeId: this.normalizeNodeId(query.node_id) } : {}),
      ...(query.payload_type ? { payloadType: query.payload_type } : {}),
      ...(query.measurement_type
        ? { measurementType: query.measurement_type }
        : {}),
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
