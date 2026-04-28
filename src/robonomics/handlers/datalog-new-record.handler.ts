import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Event } from '@polkadot/types/interfaces';
import { DatalogStatus } from '../../common/constants/datalog-status.enum.js';
import { isIpfsCid } from '../../common/utils/ipfs.util.js';
import { DatalogRepository } from '../../database/repositories/datalog.repository.js';
import type { ChainEventHandler } from '../interfaces/chain-event-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';

/**
 * Обработчик события `datalog.NewRecord`.
 * Фильтрует по whitelist аккаунтов, определяет статус (IPFS_PENDING / NEW)
 * и выполняет upsert записи в коллекцию datalog.
 */
@Injectable()
export class DatalogNewRecordHandler implements ChainEventHandler {
  readonly name = 'datalog-new-record';
  readonly section = 'datalog';
  readonly method = 'NewRecord';

  private readonly logger = new Logger(DatalogNewRecordHandler.name);
  private readonly accounts: Set<string>;

  constructor(
    private readonly config: ConfigService,
    private readonly robonomics: RobonomicsService,
    private readonly datalogRepo: DatalogRepository,
  ) {
    const list = this.config.get<string[]>('robonomics.accounts') ?? [];
    this.accounts = new Set(list);
  }

  /**
   * Обрабатывает событие datalog.NewRecord.
   * Пропускает события неуспешных экстринсиков.
   * @param event - событие блокчейна
   * @param blockNum - номер блока
   * @param isSuccess - результат экстринсика, породившего событие
   */
  async handle(
    event: Event,
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void> {
    if (!isSuccess) return;

    const api = await this.robonomics.getApi();
    if (!api.events.datalog.NewRecord.is(event)) return;

    const sender = event.data[0].toHuman();
    const timechain = event.data[1].toNumber();
    const resultHash = event.data[2].toUtf8();

    if (this.accounts.size > 0 && !this.accounts.has(sender)) {
      return;
    }

    const status = isIpfsCid(resultHash)
      ? DatalogStatus.IPFS_PENDING
      : DatalogStatus.NEW;

    await this.datalogRepo.upsertRecord({
      block: blockNum,
      sender,
      resultHash,
      status,
      timechain,
    });

    this.logger.debug(
      `Block ${blockNum}: datalog from ${sender} → ${status === DatalogStatus.IPFS_PENDING ? 'IPFS_PENDING' : 'NEW'}`,
    );
  }
}
