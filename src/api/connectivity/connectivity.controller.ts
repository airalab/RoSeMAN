import {
  Controller,
  Get,
  Header,
  Param,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConnectivityService } from './connectivity.service.js';
import type {
  ConnectivityLatestMessages,
  ConnectivityMaxMessages,
  ConnectivityMessagePage,
} from './connectivity.service.js';
import { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
import { ConnectivityCsvQueryDto } from './dto/connectivity-csv-query.dto.js';
import { ConnectivityMaxMessageQueryDto } from './dto/connectivity-max-message-query.dto.js';
import { ConnectivityMessageListQueryDto } from './dto/connectivity-message-list-query.dto.js';

/**
 * Формирует безопасный Content-Disposition с поддержкой Unicode-городов.
 * @param city - название города из проверенного query
 * @param start - начало периода в Unix milliseconds
 * @param end - конец периода в Unix milliseconds
 * @returns значение заголовка скачиваемого файла
 */
function buildCsvContentDisposition(
  city: string,
  start: number,
  end: number,
): string {
  const safeCity = city.replace(/["\\\r\n]/g, '_');
  const filename = `sensors_${safeCity}_${start}_${end}.csv`;
  if (/^[\x20-\x7e]+$/.test(filename)) {
    return `attachment; filename="${filename}"`;
  }

  const fallback = filename.replace(/[^\x20-\x7e]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/** Публичный versioned API Connectivity Protocol и связей сенсоров. */
@Controller('v3')
export class ConnectivityController {
  /** Создаёт controller поверх protocol-aware read service. */
  constructor(private readonly connectivityService: ConnectivityService) {}

  /** Возвращает геокодированные CPS-города по странам и регионам. */
  @Get('cities')
  async getCities(): Promise<{
    result: Record<string, Record<string, string[]>>;
  }> {
    return { result: await this.connectivityService.getCities() };
  }

  /**
   * Возвращает список идентификаторов сенсоров текущего владельца.
   * GET /api/v3/sensors/:owner
   * @param owner - адрес владельца
   */
  @Get('sensors/:owner')
  async getSensorsByOwner(
    @Param('owner') owner: string,
  ): Promise<{ result: string[] }> {
    return {
      result: await this.connectivityService.getSensorIdsByOwner(owner),
    };
  }

  /**
   * Возвращает TSV-файл с публичными CPS-показаниями сенсоров города.
   * GET /api/v3/messages/csv
   * @param query - город и обязательный диапазон в Unix milliseconds
   * @param response - HTTP-ответ с заголовками скачиваемого файла
   */
  @Get('messages/csv')
  async getMessagesCsv(
    @Query() query: ConnectivityCsvQueryDto,
    @Res() response: Response,
  ): Promise<void> {
    const csv = await this.connectivityService.getMessagesCsv(query);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      buildCsvContentDisposition(query.city, query.start, query.end),
    );
    response.send(csv);
  }

  /**
   * Возвращает валидные SignedEnvelope с декодированным core.v1.Message.
   * GET /api/v3/messages/json
   * @param query - необязательные границы дат, фильтры, limit и cursor
   */
  @Get('messages/json')
  async getMessagesJson(
    @Query() query: ConnectivityMessageListQueryDto,
  ): Promise<{ result: ConnectivityMessagePage }> {
    return { result: await this.connectivityService.getMessagesJson(query) };
  }

  /**
   * Возвращает самое новое валидное сообщение каждого сенсора в диапазоне.
   * GET /api/v3/messages/latest/json
   * @param query - обязательный диапазон дат и необязательные фильтры
   */
  @Get('messages/latest/json')
  async getLatestMessagesJson(
    @Query() query: ConnectivityLatestMessageQueryDto,
  ): Promise<{ result: ConnectivityLatestMessages }> {
    return {
      result: await this.connectivityService.getLatestMessagesJson(query),
    };
  }

  /**
   * Возвращает сообщение с максимальным показателем для каждого сенсора.
   * GET /api/v3/messages/max/json
   * @param query - обязательный диапазон, тип показателя и фильтры
   */
  @Get('messages/max/json')
  async getMaxMessagesJson(
    @Query() query: ConnectivityMaxMessageQueryDto,
  ): Promise<{ result: ConnectivityMaxMessages }> {
    return {
      result: await this.connectivityService.getMaxMessagesJson(query),
    };
  }

  /**
   * Возвращает SignedEnvelopeBatch страницы и курсор в HTTP-заголовке.
   * GET /api/v3/messages
   * @param query - необязательные границы дат, фильтры, limit и cursor
   * @param response - HTTP-ответ для установки заголовка X-Next-Cursor
   * @returns поток с бинарным protobuf SignedEnvelopeBatch
   */
  @Get('messages')
  @Header('Access-Control-Expose-Headers', 'X-Next-Cursor')
  async getMessagesProtobuf(
    @Query() query: ConnectivityMessageListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const page = await this.connectivityService.getMessagesProtobuf(query);
    if (page.next_cursor) response.setHeader('X-Next-Cursor', page.next_cursor);
    return new StreamableFile(page.bytes, { type: 'application/protobuf' });
  }

  /**
   * Возвращает последние сообщения сенсоров как SignedEnvelopeBatch.
   * GET /api/v3/messages/latest
   * @param query - обязательный диапазон дат и необязательные фильтры
   * @returns поток с бинарным protobuf SignedEnvelopeBatch
   */
  @Get('messages/latest')
  async getLatestMessagesProtobuf(
    @Query() query: ConnectivityLatestMessageQueryDto,
  ): Promise<StreamableFile> {
    return new StreamableFile(
      await this.connectivityService.getLatestMessagesProtobuf(query),
      { type: 'application/protobuf' },
    );
  }

  /**
   * Возвращает максимальные сообщения сенсоров как SignedEnvelopeBatch.
   * GET /api/v3/messages/max
   * @param query - обязательный диапазон, тип показателя и фильтры
   * @returns поток с бинарным protobuf SignedEnvelopeBatch
   */
  @Get('messages/max')
  async getMaxMessagesProtobuf(
    @Query() query: ConnectivityMaxMessageQueryDto,
  ): Promise<StreamableFile> {
    return new StreamableFile(
      await this.connectivityService.getMaxMessagesProtobuf(query),
      { type: 'application/protobuf' },
    );
  }
}
