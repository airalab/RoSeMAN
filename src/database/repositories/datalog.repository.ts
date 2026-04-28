import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type Types } from 'mongoose';
import { DatalogStatus } from '../../common/constants/datalog-status.enum.js';
import { Datalog, type DatalogDocument } from '../schemas/datalog.schema.js';

/**
 * Репозиторий для работы с коллекцией datalog.
 */
@Injectable()
export class DatalogRepository {
  constructor(
    @InjectModel(Datalog.name)
    private readonly model: Model<DatalogDocument>,
  ) {}

  /**
   * Находит записи datalog со статусом IPFS_PENDING.
   * @param limit - максимальное количество результатов
   */
  async findPending(limit: number): Promise<DatalogDocument[]> {
    return this.model
      .find({ status: DatalogStatus.IPFS_PENDING })
      .limit(limit)
      .exec();
  }

  /**
   * Обновляет статус записи datalog.
   * @param id - ObjectId записи
   * @param status - новый статус
   * @param errorMessage - сообщение об ошибке (опционально)
   */
  async updateStatus(
    id: Types.ObjectId,
    status: DatalogStatus,
    errorMessage?: string,
  ): Promise<void> {
    const update: Record<string, unknown> = { status };
    if (errorMessage !== undefined) {
      update.errorMessage = errorMessage;
    }
    await this.model.updateOne({ _id: id }, { $set: update });
  }

  /**
   * Выполняет upsert записи datalog по составному ключу (block, sender, resultHash).
   * @param data - данные записи
   */
  async upsertRecord(data: {
    block: number;
    sender: string;
    resultHash: string;
    status: DatalogStatus;
    timechain?: number;
  }): Promise<void> {
    const { block, sender, resultHash, status, timechain } = data;
    await this.model.updateOne(
      { block, sender, resultHash },
      {
        $setOnInsert: { block, sender, resultHash, status, timechain },
      },
      { upsert: true },
    );
  }

  /**
   * Вернет кол-во документов с статусом IPFS_PENDING
   */
  async getCountIpfsPending(): Promise<number> {
    return await this.model
      .countDocuments({ status: DatalogStatus.IPFS_PENDING })
      .exec();
  }
}
