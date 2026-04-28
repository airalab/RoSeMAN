import type { GenericExtrinsic } from '@polkadot/types';
import type { AnyTuple } from '@polkadot/types-codec/types';
import type { Event } from '@polkadot/types/interfaces';

/**
 * Интерфейс обработчика экстринсика блокчейна.
 * Каждый хендлер объявляет `section` и `method` экстринсика, который его интересует.
 * Сканер блоков матчит экстринсики и вызывает `handle()`.
 */
export interface ChainExtrinsicHandler {
  /** Уникальное имя хендлера для фильтрации через ENABLED_HANDLERS/DISABLED_HANDLERS. */
  readonly name: string;
  readonly section: string;
  readonly method?: string;

  /**
   * Обрабатывает экстринсик блокчейна.
   * @param extrinsic - полный экстринсик из блока (включая signer, hash и т.д.)
   * @param events - события, порождённые этим экстринсиком (phase=ApplyExtrinsic(idx))
   * @param blockNum - номер блока, в котором находится экстринсик
   * @param isSuccess - результат выполнения экстринсика (system.ExtrinsicSuccess/Failed)
   */
  handle(
    extrinsic: GenericExtrinsic<AnyTuple>,
    events: Event[],
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void>;
}
