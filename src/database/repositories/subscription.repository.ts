import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type AnyBulkWriteOperation, Model } from 'mongoose';
import {
  Subscription,
  type SubscriptionDocument,
} from '../schemas/subscription.schema.js';

/**
 * Репозиторий для работы с коллекцией subscription.
 */
@Injectable()
export class SubscriptionRepository {
  constructor(
    @InjectModel(Subscription.name)
    private readonly model: Model<SubscriptionDocument>,
  ) {}

  /**
   * Обновляет номер блока для записи subscription либо создаёт новую,
   * если пары (account, owner) ещё нет в коллекции.
   * @param account - адрес аккаунта
   * @param owner - адрес владельца
   * @param block - номер блока
   * @returns `{ matched, inserted }` — был ли апдейт существующей записи или вставка
   */
  async upsertBlock(
    account: string,
    owner: string,
    block: number,
  ): Promise<{ matched: number; inserted: boolean }> {
    const result = await this.model.updateOne(
      { account, owner },
      {
        $set: { block },
        $setOnInsert: { account, owner },
      },
      { upsert: true },
    );
    return {
      matched: result.matchedCount,
      inserted: (result.upsertedCount ?? 0) > 0,
    };
  }

  /**
   * Удаляет подписки owner, аккаунты которых не входят в переданный список.
   * @param owner - адрес владельца
   * @param accounts - список аккаунтов, которые нужно сохранить
   */
  async deleteByOwnerExcept(owner: string, accounts: string[]): Promise<void> {
    await this.model.deleteMany({
      owner,
      account: { $nin: accounts },
    });
  }

  /**
   * Возвращает маппинг account → owner для указанных аккаунтов.
   * Если у аккаунта несколько подписок, берётся первая найденная.
   * @param accounts - список адресов аккаунтов
   */
  async findOwnersByAccounts(accounts: string[]): Promise<Map<string, string>> {
    if (accounts.length === 0) return new Map();

    const docs = await this.model
      .find({ account: { $in: accounts } })
      .select('account owner')
      .lean()
      .exec();

    const map = new Map<string, string>();
    for (const doc of docs) {
      if (!map.has(doc.account)) {
        map.set(doc.account, doc.owner);
      }
    }

    return map;
  }

  /**
   * Возвращает список account (sensor_id) для указанного owner.
   * @param owner - адрес владельца
   */
  async findAccountsByOwner(owner: string): Promise<string[]> {
    const docs = await this.model
      .find({ owner })
      .select('account')
      .lean()
      .exec();

    return docs.map((d) => d.account);
  }

  /**
   * Выполняет bulkWrite upsert для массива аккаунтов owner.
   * @param entries - массив пар { account, owner }
   */
  async bulkUpsert(
    entries: Array<{ account: string; owner: string }>,
  ): Promise<void> {
    if (entries.length === 0) return;

    const ops: AnyBulkWriteOperation<Subscription>[] = entries.map(
      ({ account, owner }) => ({
        updateOne: {
          filter: { account, owner },
          update: { $setOnInsert: { account, owner } },
          upsert: true,
        },
      }),
    );

    await this.model.bulkWrite(ops);
  }
}
