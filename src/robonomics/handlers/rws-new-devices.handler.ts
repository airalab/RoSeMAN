import { Injectable, Logger } from '@nestjs/common';
import type { Event } from '@polkadot/types/interfaces';
import { SubscriptionRepository } from '../../database/repositories/subscription.repository.js';
import type { ChainEventHandler } from '../interfaces/chain-event-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';

/**
 * Обработчик события `rws.NewDevices`.
 * Сохраняет каждый аккаунт из списка устройств подписки в коллекцию subscription.
 */
@Injectable()
export class RwsNewDevicesHandler implements ChainEventHandler {
  readonly name = 'rws-new-devices';
  readonly section = 'rws';
  readonly method = 'NewDevices';

  private readonly logger = new Logger(RwsNewDevicesHandler.name);

  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly subscriptionRepo: SubscriptionRepository,
  ) {}

  /**
   * Обрабатывает событие rws.NewDevices.
   * Синхронизирует список устройств owner: добавляет новые аккаунты
   * и удаляет те, которых больше нет в актуальном списке.
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
    if (!api.events.rws.NewDevices.is(event)) return;

    const owner = event.data[0].toHuman();
    const accounts = event.data[1].map((d) => d.toHuman());

    await this.subscriptionRepo.deleteByOwnerExcept(owner, accounts);
    await this.subscriptionRepo.bulkUpsert(
      accounts.map((account) => ({ account, owner })),
    );

    this.logger.debug(
      `Block ${blockNum}: rws.NewDevices owner=${owner}, synced ${accounts.length} devices`,
    );
  }
}
