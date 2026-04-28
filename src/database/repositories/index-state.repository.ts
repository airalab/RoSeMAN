import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  IndexState,
  type IndexStateDocument,
} from '../schemas/index-state.schema.js';

/**
 * Репозиторий для работы с коллекцией index_state.
 */
@Injectable()
export class IndexStateRepository {
  constructor(
    @InjectModel(IndexState.name)
    private readonly model: Model<IndexStateDocument>,
  ) {}

  /**
   * Получает значение по ключу.
   * @param key - ключ состояния
   * @returns числовое значение или null, если не найдено
   */
  async getValue(key: string): Promise<number | null> {
    const doc = await this.model.findOne({ key }).exec();
    return doc ? doc.value : null;
  }

  /**
   * Создаёт или обновляет значение по ключу.
   * @param key - ключ состояния
   * @param value - числовое значение
   */
  async upsertValue(key: string, value: number): Promise<void> {
    await this.model.updateOne({ key }, { $set: { value } }, { upsert: true });
  }

  /**
   * Вернет все документы из коллекции
   */
  async getAllIndex(): Promise<IndexStateDocument[]> {
    return await this.model.find().exec();
  }
}
