import type { Event } from '@polkadot/types/interfaces';

/**
 * Интерфейс обработчика события блокчейна.
 * Каждый хендлер объявляет `section` и `method` события, которое его интересует.
 * Сканер блоков матчит события и вызывает `handle()`.
 */
export interface ChainEventHandler {
  /** Уникальное имя хендлера для фильтрации через ENABLED_HANDLERS/DISABLED_HANDLERS. */
  readonly name: string;
  readonly section: string;
  readonly method: string;

  /**
   * Обрабатывает событие блокчейна.
   * @param event - декодированное событие из блока
   * @param blockNum - номер блока, в котором произошло событие
   * @param isSuccess - результат экстринсика, породившего событие
   *                     (true для событий фаз Initialization/Finalization)
   */
  handle(event: Event, blockNum: number, isSuccess: boolean): Promise<void>;
}
