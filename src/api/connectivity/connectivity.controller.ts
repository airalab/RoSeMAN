import { Controller, Get, Query } from '@nestjs/common';
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
   * GET /api/v3/messages
   * @param query - необязательные границы дат, фильтры, limit и cursor
   */
  @Get('messages')
  async getMessages(
    @Query() query: ConnectivityMessageListQueryDto,
  ): Promise<{ result: ConnectivityMessagePage }> {
    return { result: await this.connectivityService.getMessages(query) };
  }

  /**
   * Возвращает самое новое валидное сообщение каждого сенсора в диапазоне.
   * GET /api/v3/messages/latest
   * @param query - обязательный диапазон дат и необязательные фильтры
   */
  @Get('messages/latest')
  async getLatestMessages(
    @Query() query: ConnectivityLatestMessageQueryDto,
  ): Promise<{ result: ConnectivityLatestMessages }> {
    return { result: await this.connectivityService.getLatestMessages(query) };
  }
}
