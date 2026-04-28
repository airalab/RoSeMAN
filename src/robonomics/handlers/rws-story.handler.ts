import { Injectable, Logger } from '@nestjs/common';
import type { GenericExtrinsic } from '@polkadot/types';
import type { AnyTuple } from '@polkadot/types-codec/types';
import type { Event } from '@polkadot/types/interfaces';
import { SensorModel } from '../../common/constants/sensor-model.enum.js';
import { isIpfsCid } from '../../common/utils/ipfs.util.js';
import { StoryRepository } from '../../database/repositories/story.repository.js';
import { SubscriptionRepository } from '../../database/repositories/subscription.repository.js';
import type { ChainExtrinsicHandler } from '../interfaces/chain-extrinsic-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';

interface StoryPayload {
  model: number;
  sensor: string;
  message: string;
  timestamp: number;
  i?: string;
  date?: string | null;
}

/**
 * Обработчик экстринсика `rws.call`.
 * Для каждого события `datalog.NewRecord`, порождённого этим экстринсиком,
 * проверяет что подписант (owner) присутствует в коллекции subscription,
 * парсит inline-JSON и сохраняет записи типа Story (model=5).
 */
@Injectable()
export class RwsStoryHandler implements ChainExtrinsicHandler {
  readonly name = 'rws-story';
  readonly section = 'rws';
  readonly method = 'call';

  private readonly logger = new Logger(RwsStoryHandler.name);

  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly subscriptionRepo: SubscriptionRepository,
    private readonly storyRepo: StoryRepository,
  ) {}

  /**
   * @param extrinsic - экстринсик из секции rws (любой метод)
   * @param events - события, порождённые этим экстринсиком
   * @param blockNum - номер блока
   * @param isSuccess - результат выполнения экстринсика
   */
  async handle(
    extrinsic: GenericExtrinsic<AnyTuple>,
    events: Event[],
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void> {
    if (!isSuccess) return;

    const signer = extrinsic.signer.toString();

    const ownedAccounts =
      await this.subscriptionRepo.findAccountsByOwner(signer);
    if (ownedAccounts.length === 0) return;

    const api = await this.robonomics.getApi();

    for (const event of events) {
      if (!api.events.datalog.NewRecord.is(event)) continue;

      const sender = String(event.data[0].toHuman() ?? '');
      const timechain = event.data[1].toNumber();
      const resultHash = event.data[2].toUtf8();

      if (isIpfsCid(resultHash)) continue;

      const payload = this.parsePayload(resultHash);
      if (!payload) continue;

      if (!ownedAccounts.includes(payload.sensor)) {
        continue;
      }

      await this.storyRepo.upsert({
        block: blockNum,
        author: sender,
        timechain,
        sensor_id: payload.sensor,
        message: payload.message,
        icon: payload.i ?? '',
        timestamp: payload.timestamp,
        date: payload.date ?? null,
      });

      this.logger.debug(
        `Block ${blockNum}: story saved (signer=${signer}, sensor=${payload.sensor})`,
      );
    }
  }

  /**
   * Парсит JSON-строку и валидирует payload Story.
   * @param raw - сырая строка из resultHash
   */
  private parsePayload(raw: string): StoryPayload | null {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }

    if (data == null || typeof data !== 'object') return null;

    const d = data as Record<string, unknown>;
    if (
      d.model !== SensorModel.STORY ||
      typeof d.sensor !== 'string' ||
      typeof d.message !== 'string' ||
      typeof d.timestamp !== 'number'
    ) {
      return null;
    }

    return {
      model: d.model,
      sensor: d.sensor,
      message: d.message,
      timestamp: d.timestamp,
      i: typeof d.i === 'string' ? d.i : undefined,
      date: typeof d.date === 'string' ? d.date : null,
    };
  }
}
