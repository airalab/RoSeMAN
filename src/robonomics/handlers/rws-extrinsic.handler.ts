import { Injectable, Logger } from '@nestjs/common';
import type { GenericExtrinsic } from '@polkadot/types';
import type { AnyTuple } from '@polkadot/types-codec/types';
import type { Event } from '@polkadot/types/interfaces';
import { SubscriptionRepository } from '../../database/repositories/subscription.repository.js';
import type { ChainExtrinsicHandler } from '../interfaces/chain-extrinsic-handler.interface.js';

/**
 * Обработчик экстринсиков секции `rws`.
 * При успешном выполнении любого rws-экстринсика выполняет upsert
 * записи subscription (account = signer, owner = args[0]): существующую
 * запись обновляет номером блока, отсутствующую — создаёт.
 */
@Injectable()
export class RwsExtrinsicHandler implements ChainExtrinsicHandler {
  readonly name = 'rws-extrinsic';
  readonly section = 'rws';
  readonly method = 'call';

  private readonly logger = new Logger(RwsExtrinsicHandler.name);

  constructor(private readonly subscriptionRepo: SubscriptionRepository) {}

  /**
   * Выполняет upsert записи subscription: обновляет block или создаёт новую.
   * @param extrinsic - экстринсик из секции rws
   * @param events - события этого экстринсика (не используется)
   * @param blockNum - номер блока
   * @param isSuccess - результат выполнения экстринсика
   */
  async handle(
    extrinsic: GenericExtrinsic<AnyTuple>,
    events: Event[],
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void> {
    void events;
    if (!isSuccess) return;

    const account = extrinsic.signer.toString();
    const owner = extrinsic.args[0].toString();

    const { inserted } = await this.subscriptionRepo.upsertBlock(
      account,
      owner,
      blockNum,
    );

    this.logger.debug(
      `Block ${blockNum}: rws extrinsic account=${account}, owner=${owner} (${inserted ? 'inserted' : 'updated'})`,
    );
  }
}
