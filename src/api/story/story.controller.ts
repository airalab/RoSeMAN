import { Controller, Get, Param, Query } from '@nestjs/common';
import { StoryListQueryDto } from './dto/story-list-query.dto.js';
import {
  StoryService,
  type StoryLastItem,
  type StoryListResult,
} from './story.service.js';

/**
 * Контроллер для доступа к историям.
 */
@Controller('v2/story')
export class StoryController {
  constructor(private readonly storyService: StoryService) {}

  /**
   * Возвращает страницу историй, отсортированных по timestamp (desc).
   * GET /api/v2/story/list?limit=&page=&start=&end=
   * @param query - параметры пагинации и фильтрации по timestamp
   */
  @Get('list')
  async getList(
    @Query() query: StoryListQueryDto,
  ): Promise<{ result: StoryListResult }> {
    const result = await this.storyService.getList({
      limit: query.limit,
      page: query.page,
      start: query.start,
      end: query.end,
    });
    return { result };
  }

  /**
   * Возвращает последнюю историю для указанного сенсора.
   * GET /api/v2/story/last/:sensor_id
   * @param sensorId - идентификатор сенсора
   */
  @Get('last/:sensor_id')
  async getLast(
    @Param('sensor_id') sensorId: string,
  ): Promise<{ result: StoryLastItem | null }> {
    const result = await this.storyService.getLastBySensorId(sensorId);
    return { result };
  }
}
