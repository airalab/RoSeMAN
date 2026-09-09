import {
  Controller,
  Get,
  Header,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConnectivityService } from './connectivity.service.js';
import type {
  ConnectivityLatestMessages,
  ConnectivityMessagePage,
} from './connectivity.service.js';
import { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
import { ConnectivityMessageListQueryDto } from './dto/connectivity-message-list-query.dto.js';

/** Публичный versioned API сохранённых сообщений Connectivity Protocol. */
@Controller('v3')
export class ConnectivityController {
  /** Создаёт controller поверх protocol-aware read service. */
  constructor(private readonly connectivityService: ConnectivityService) {}

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
}
