import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ApiPromise } from '@polkadot/api';
import type { Event, Header } from '@polkadot/types/interfaces';
import { START_BLOCK_LATEST } from '../config/robonomics.config.js';
import { IndexStateRepository } from '../database/repositories/index-state.repository.js';
import { EVENT_HANDLERS, EXTRINSIC_HANDLERS } from './constants.js';
import type { ChainEventHandler } from './interfaces/chain-event-handler.interface.js';
import type { ChainExtrinsicHandler } from './interfaces/chain-extrinsic-handler.interface.js';
import { RobonomicsService } from './robonomics.service.js';

const BATCH_SIZE = 10;
const RECONNECT_DELAY = 15_000;

/**
 * Универсальный сканер блоков.
 * Выполняет catch-up от последнего проиндексированного блока и подписку
 * на новые финализированные блоки. Делегирует обработку событий
 * массиву `ChainEventHandler`, инжектированных через DI-токен.
 */
@Injectable()
export class BlockIndexerService implements OnModuleInit {
  private readonly logger = new Logger(BlockIndexerService.name);
  private readonly stateKey: string;
  private reconnecting = false;
  private unsubscribeHeads?: () => void;
  /**
   * Отписка от событий текущего ApiPromise. Хранится, чтобы при
   * переподключении не срабатывали обработчики уже отключённого соединения.
   */
  private unsubscribeApiEvents?: () => void;
  /**
   * Актуальный экземпляр ApiPromise, используемый в текущем цикле.
   * При реконнекте RobonomicsService создаёт новый API, а старый,
   * отключаемый экземпляр может продолжать эмитить `disconnected`.
   * Проверка по ссылке защищает от запуска лишнего переподключения.
   */
  private currentApi?: ApiPromise;
  /**
   * Очередь номеров блоков, поступивших из подписки на финализированные
   * заголовки. Обработка ведётся строго последовательно в одном рабочем
   * цикле, что исключает параллельную/двойную обработку одного блока.
   */
  private readonly realtimeQueue: number[] = [];
  private realtimeProcessing = false;
  /**
   * Промис текущего рабочего цикла очереди. Даёт возможность дождаться
   * завершения обработки в `cleanup()` перед переподключением, чтобы
   * старый цикл не пересекался с новым catch-up.
   */
  private realtimeProcessingPromise: Promise<void> = Promise.resolve();

  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly config: ConfigService,
    private readonly indexStateRepo: IndexStateRepository,
    @Inject(EVENT_HANDLERS)
    private readonly handlers: ChainEventHandler[],
    @Inject(EXTRINSIC_HANDLERS)
    private readonly extrinsicHandlers: ChainExtrinsicHandler[],
  ) {
    this.stateKey =
      this.config.get<string>('robonomics.stateKey') ?? 'polkadot_robonomics';
  }

  onModuleInit(): void {
    this.run();
  }

  /**
   * Обёртка над start() с автоматическим переподключением при ошибках.
   * При падении запускает единый отложенный реконнект.
   */
  private run(): void {
    this.start().catch((err) => {
      this.logger.error(
        'Indexer error',
        err instanceof Error ? err.stack : err,
      );
      this.scheduleReconnect();
    });
  }

  /**
   * Запускает catch-up и подписку на финализированные блоки.
   * Возвращает Promise, который reject-ится при обрыве WebSocket-соединения.
   */
  private async start(): Promise<void> {
    const api = await this.robonomics.getApi();
    this.currentApi = api;

    const startBlock =
      this.config.get<number | typeof START_BLOCK_LATEST>(
        'robonomics.startBlock',
      ) ?? START_BLOCK_LATEST;
    const startBlockForce =
      this.config.get<boolean>('robonomics.startBlockForce') ?? false;
    const savedBlock = await this.indexStateRepo.getValue(this.stateKey);

    if (startBlockForce) {
      this.logger.warn(
        'ROBONOMICS_START_BLOCK_FORCE=true — indexing is forcibly started ' +
          'from the ROBONOMICS_START_BLOCK value, the block saved in the DB ' +
          'is ignored. Do not forget to disable it (false) after launch, ' +
          'otherwise it will trigger on every restart.',
      );
    }

    let from: number;
    if (savedBlock !== null && !startBlockForce) {
      from = savedBlock + 1;
    } else if (startBlock === START_BLOCK_LATEST) {
      // Первый запуск без сохранённого состояния: стартуем с текущего
      // финализированного блока в чейне, а не с самого начала истории.
      from = await this.getFinalizedBlock(api);
    } else {
      from = startBlock;
    }

    this.logger.log(`Starting catch-up from block ${from}`);

    // Catch-up loop
    while (true) {
      const finalized = await this.getFinalizedBlock(api);

      if (from > finalized) break;

      const to = Math.min(from + BATCH_SIZE - 1, finalized);
      this.logger.log(
        `Processing blocks ${from}–${to} (finalized: ${finalized})`,
      );

      for (let blockNum = from; blockNum <= to; blockNum++) {
        await this.processBlock(blockNum);
        await this.indexStateRepo.upsertValue(this.stateKey, blockNum);
      }

      from = to + 1;
    }

    this.logger.log('Catch-up complete, subscribing to finalized heads');

    // Realtime subscription
    this.unsubscribeHeads = await api.rpc.chain.subscribeFinalizedHeads(
      (header: Header) => {
        const blockNum = header.number.toNumber();
        this.realtimeQueue.push(blockNum);
        void this.processRealtimeQueue();
      },
    );

    // При обрыве соединения запускаем переподключение.
    // Обработчики привязываются к конкретному экземпляру ApiPromise,
    // поэтому после замены API старые события игнорируются.
    const onApiError = (err: unknown) => {
      if (this.currentApi !== api) return;
      this.logger.error(
        'Chain API error',
        err instanceof Error ? err.stack : err,
      );
      this.scheduleReconnect();
    };

    const onApiDisconnected = () => {
      if (this.currentApi !== api) return;
      this.logger.warn('Chain WebSocket disconnected');
      this.scheduleReconnect();
    };

    api.on('error', onApiError);
    api.on('disconnected', onApiDisconnected);

    this.unsubscribeApiEvents = () => {
      api.off('error', onApiError);
      api.off('disconnected', onApiDisconnected);
    };
  }

  /**
   * Отписывается от подписки на финализированные блоки и дожидается
   * завершения текущего рабочего цикла очереди, чтобы старая обработка
   * не пересекалась с новым catch-up при переподключении.
   */
  private async cleanup(): Promise<void> {
    if (this.unsubscribeHeads) {
      this.unsubscribeHeads();
      this.unsubscribeHeads = undefined;
    }

    if (this.unsubscribeApiEvents) {
      this.unsubscribeApiEvents();
      this.unsubscribeApiEvents = undefined;
    }

    this.currentApi = undefined;

    // Очищаем очередь, чтобы блоки из старой подписки не обрабатывались
    // новым циклом после переподключения — catch-up в `start()` их покроет.
    this.realtimeQueue.length = 0;

    await this.realtimeProcessingPromise.catch(() => undefined);
  }

  /**
   * Запускает отложенное переподключение.
   * Флаг reconnecting защищает от повторных вызовов,
   * если error и disconnected сработают одновременно.
   */
  private scheduleReconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;

    this.logger.warn(`Reconnecting in ${RECONNECT_DELAY / 1000}s...`);

    void this.cleanup()
      .then(() => this.sleep(RECONNECT_DELAY))
      .then(() => this.robonomics.reconnect())
      .catch((err) => {
        this.logger.error(
          'Reconnect failed',
          err instanceof Error ? err.stack : err,
        );
      })
      .finally(() => {
        this.reconnecting = false;
        this.run();
      });
  }

  /**
   * Обрабатывает все события и экстринсики блока, делегируя каждому подходящему хендлеру.
   * @param blockNum - номер блока для обработки
   */
  private async processBlock(blockNum: number): Promise<void> {
    this.logger.debug(`Processing block ${blockNum}`);
    const hasEventHandlers = this.handlers.length > 0;
    const hasExtrinsicHandlers = this.extrinsicHandlers.length > 0;

    if (!hasEventHandlers && !hasExtrinsicHandlers) return;

    const api = await this.robonomics.getApi();

    const blockHash = await api.rpc.chain.getBlockHash(blockNum);

    // Events нужны и для event-хендлеров, и для построения карты успешности экстринсиков
    const events = await api.query.system.events.at(blockHash);

    // Карта результата экстринсиков: index → success
    const extrinsicSuccess = new Map<number, boolean>();
    // Карта событий по индексу экстринсика, породившего их
    const eventsByExtrinsic = new Map<number, Event[]>();
    for (const { event, phase } of events) {
      if (!phase.isApplyExtrinsic) continue;

      const idx = phase.asApplyExtrinsic.toNumber();

      if (event.section === 'system') {
        if (event.method === 'ExtrinsicSuccess') {
          extrinsicSuccess.set(idx, true);
        } else if (event.method === 'ExtrinsicFailed') {
          extrinsicSuccess.set(idx, false);
        }
      }

      const arr = eventsByExtrinsic.get(idx);
      if (arr) {
        arr.push(event);
      } else {
        eventsByExtrinsic.set(idx, [event]);
      }
    }

    // Events
    for (const { event, phase } of events) {
      const isSuccess = phase.isApplyExtrinsic
        ? (extrinsicSuccess.get(phase.asApplyExtrinsic.toNumber()) ?? true)
        : true;

      for (const handler of this.handlers) {
        if (
          event.section === handler.section &&
          event.method === handler.method
        ) {
          await handler.handle(event, blockNum, isSuccess);
        }
      }
    }

    // Extrinsics — пропускаем RPC-вызов getBlock, если хендлеров нет
    if (hasExtrinsicHandlers) {
      const signedBlock = await api.rpc.chain.getBlock(blockHash);
      const extrinsics = signedBlock.block.extrinsics;

      for (let i = 0; i < extrinsics.length; i++) {
        const extrinsic = extrinsics[i];
        const isSuccess = extrinsicSuccess.get(i) ?? true;
        const extrinsicEvents = eventsByExtrinsic.get(i) ?? [];

        for (const handler of this.extrinsicHandlers) {
          if (
            extrinsic.method.section === handler.section &&
            (!handler.method || extrinsic.method.method === handler.method)
          ) {
            await handler.handle(
              extrinsic,
              extrinsicEvents,
              blockNum,
              isSuccess,
            );
          }
        }
      }
    }
  }

  /**
   * Рабочий цикл очереди блоков из подписки.
   * Берёт блоки из `realtimeQueue` по одному и обрабатывает последовательно.
   * Возвращает промис, который резолвится, когда очередь опустошена.
   * `realtimeProcessing` не даёт запустить несколько циклов параллельно;
   * сохранённый `realtimeProcessingPromise` позволяет дождаться завершения
   * цикла в `cleanup()` перед переподключением.
   */
  private processRealtimeQueue(): Promise<void> {
    if (this.realtimeProcessing) return this.realtimeProcessingPromise;
    this.realtimeProcessing = true;

    this.realtimeProcessingPromise = (async () => {
      try {
        while (this.realtimeQueue.length > 0) {
          const blockNum = this.realtimeQueue.shift()!;
          try {
            await this.processNewFinalizedBlock(blockNum);
          } catch (err) {
            this.logger.error(
              `Error processing finalized head ${blockNum}`,
              err instanceof Error ? err.stack : err,
            );
          }
        }
      } finally {
        this.realtimeProcessing = false;
      }
    })();

    return this.realtimeProcessingPromise;
  }

  /**
   * Обрабатывает новый финализированный заголовок и все блоки между
   * последним сохранённым и полученным, чтобы не пропускать блоки
   * при пропущенных уведомлениях подписки.
   * @param blockNum - номер блока из уведомления подписки
   */
  private async processNewFinalizedBlock(blockNum: number): Promise<void> {
    const savedBlock = await this.indexStateRepo.getValue(this.stateKey);
    const lastProcessed = savedBlock ?? blockNum - 1;

    // Блок уже был обработан ранее — пропускаем, чтобы избежать дублей.
    if (blockNum <= lastProcessed) {
      this.logger.debug(
        `Block ${blockNum} already processed (lastProcessed=${lastProcessed}), skipping`,
      );
      return;
    }

    if (blockNum > lastProcessed + 1) {
      this.logger.warn(
        `Detected skipped finalized blocks between ${lastProcessed + 1} and ${blockNum - 1}, catching up`,
      );

      for (let num = lastProcessed + 1; num < blockNum; num++) {
        await this.processBlock(num);
        await this.indexStateRepo.upsertValue(this.stateKey, num);
      }
    }

    await this.processBlock(blockNum);
    await this.indexStateRepo.upsertValue(this.stateKey, blockNum);
  }

  /**
   * Возвращает номер последнего финализированного блока в чейне.
   * @param api - подключённый экземпляр ApiPromise
   * @returns номер финализированного блока
   */
  private async getFinalizedBlock(api: ApiPromise): Promise<number> {
    const finalizedHash = await api.rpc.chain.getFinalizedHead();
    const finalizedHeader = await api.rpc.chain.getHeader(finalizedHash);
    return finalizedHeader.number.toNumber();
  }

  /** @param ms - время ожидания в миллисекундах */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
