import { Injectable } from '@nestjs/common';
import { StoryRepository } from '../../database/repositories/story.repository.js';

export interface StoryListItem {
  author: string;
  sensor_id: string;
  message: string;
  timestamp: number;
  date: string | null;
  icon: string;
}

export interface StoryListResult {
  totalPages: number;
  list: StoryListItem[];
}

export interface StoryLastItem {
  author: string;
  message: string;
  date: string | null;
  timestamp: number;
  icon: string;
}

/**
 * Сервис для чтения историй.
 */
@Injectable()
export class StoryService {
  constructor(private readonly storyRepo: StoryRepository) {}

  /**
   * Возвращает страницу историй с мета-полем totalPages.
   * @param params - параметры пагинации и фильтрации
   */
  async getList(params: {
    limit: number;
    page: number;
    start?: number;
    end?: number;
  }): Promise<StoryListResult> {
    const { items, total } = await this.storyRepo.findPaginated({
      start: params.start,
      end: params.end,
      skip: (params.page - 1) * params.limit,
      limit: params.limit,
    });

    const totalPages = total === 0 ? 0 : Math.ceil(total / params.limit);

    return {
      totalPages,
      list: items.map((doc) => ({
        author: doc.author,
        sensor_id: doc.sensor_id,
        message: doc.message,
        timestamp: doc.timestamp,
        date: doc.date,
        icon: doc.icon,
      })),
    };
  }

  /**
   * Возвращает последнюю историю указанного сенсора или null, если её нет.
   * @param sensorId - идентификатор сенсора
   */
  async getLastBySensorId(sensorId: string): Promise<StoryLastItem | null> {
    const doc = await this.storyRepo.findLastBySensorId(sensorId);
    if (!doc) return null;

    return {
      author: doc.author,
      message: doc.message,
      date: doc.date,
      timestamp: doc.timestamp,
      icon: doc.icon,
    };
  }
}
