import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Story, type StoryDocument } from '../schemas/story.schema.js';

export interface StoryInput {
  block?: number;
  author: string;
  sensor_id: string;
  message: string;
  icon?: string;
  timestamp: number;
  timechain?: number;
  date?: string | null;
}

/**
 * Репозиторий для работы с коллекцией story.
 */
@Injectable()
export class StoryRepository {
  constructor(
    @InjectModel(Story.name)
    private readonly model: Model<StoryDocument>,
  ) {}

  /**
   * Выполняет upsert истории по уникальному ключу (sensor_id, timestamp).
   * Повторные записи не перезаписывают существующие.
   * @param story - данные истории
   */
  async upsert(story: StoryInput): Promise<void> {
    await this.model.updateOne(
      { sensor_id: story.sensor_id, timestamp: story.timestamp },
      { $setOnInsert: story },
      { upsert: true },
    );
  }

  /**
   * Возвращает последнюю историю указанного сенсора (по timestamp desc).
   * @param sensorId - идентификатор сенсора
   */
  async findLastBySensorId(sensorId: string): Promise<StoryDocument | null> {
    return this.model
      .findOne({ sensor_id: sensorId })
      .sort({ timestamp: -1 })
      .lean()
      .exec() as Promise<StoryDocument | null>;
  }

  /**
   * Возвращает страницу историй (сортировка по timestamp desc) и общее количество.
   * @param params - параметры пагинации и фильтрации по timestamp
   */
  async findPaginated(params: {
    start?: number;
    end?: number;
    skip: number;
    limit: number;
  }): Promise<{ items: StoryDocument[]; total: number }> {
    const filter: Record<string, unknown> = {};
    if (params.start !== undefined || params.end !== undefined) {
      const range: Record<string, number> = {};
      if (params.start !== undefined) range.$gte = params.start;
      if (params.end !== undefined) range.$lte = params.end;
      filter.timestamp = range;
    }

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ timestamp: -1 })
        .skip(params.skip)
        .limit(params.limit)
        .lean()
        .exec() as Promise<StoryDocument[]>,
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }
}
