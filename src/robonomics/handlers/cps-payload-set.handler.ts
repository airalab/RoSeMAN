import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Codec } from '@polkadot/types/types';
import type { Event } from '@polkadot/types/interfaces';
import { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import { decodeCpsPayloadCid } from '../cps-payload.decoder.js';
import { readCpsNodeAt } from '../cps-node.reader.js';
import type { ChainEventHandler } from '../interfaces/chain-event-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';

interface CpsNodeIdCodec extends Codec {
  toBigInt(): bigint;
}

interface CpsEventMatcher {
  is(event: Event): boolean;
}

/**
 * Обработчик события `cps.PayloadSet`, создающий идемпотентный элемент очереди.
 */
@Injectable()
export class CpsPayloadSetHandler implements ChainEventHandler {
  readonly name = 'cps-payload-set';
  readonly section = 'cps';
  readonly method = 'PayloadSet';

  private readonly logger = new Logger(CpsPayloadSetHandler.name);
  private readonly configuredNodeIds: ReadonlySet<string>;

  /**
   * Создаёт обработчик CPS-событий.
   * @param robonomics - подключение к Robonomics API
   * @param cpsAnchorRepo - идемпотентная очередь найденных anchors
   * @param config - конфигурация CPS и allowlist NodeId
   */
  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly cpsAnchorRepo: CpsAnchorRepository,
    private readonly config: ConfigService,
  ) {
    this.configuredNodeIds = new Set(
      this.config.get<string[]>('cps.nodeIds', []),
    );
  }

  /**
   * Читает CPS node в состоянии блока события и сохраняет бинарный CID.
   * @param event - событие `cps.PayloadSet(NodeId, AccountId)`
   * @param blockNum - номер финализированного блока
   * @param isSuccess - успешность породившего событие экстринсика
   */
  async handle(
    event: Event,
    blockNum: number,
    isSuccess: boolean,
  ): Promise<void> {
    if (!isSuccess) return;
    if (!this.config.get<boolean>('cps.enabled', false)) return;

    const api = await this.robonomics.getApi();
    const payloadSet = (
      api.events as unknown as {
        readonly cps?: { readonly PayloadSet?: CpsEventMatcher };
      }
    ).cps?.PayloadSet;
    if (!payloadSet?.is(event)) return;

    const nodeId = event.data[0] as CpsNodeIdCodec;
    const numericNodeId = nodeId.toBigInt();
    if (!this.isNodeAllowed(numericNodeId)) {
      this.logger.debug(
        `Block ${blockNum}: CPS node ${numericNodeId} is not configured, skipping`,
      );
      return;
    }

    const owner = event.data[1].toString();
    const blockHash = await api.rpc.chain.getBlockHash(blockNum);
    const node = await readCpsNodeAt(api, blockHash, nodeId);

    if (!node?.payload) {
      this.logger.debug(
        `Block ${blockNum}: CPS node ${numericNodeId} has no payload`,
      );
      return;
    }

    const cid = decodeCpsPayloadCid(node.payload);
    await this.cpsAnchorRepo.upsertAnchor({
      nodeId: numericNodeId,
      block: blockNum,
      cid,
      owner,
    });

    this.logger.debug(
      `Block ${blockNum}: queued CPS node ${numericNodeId} payload ${cid}`,
    );
  }

  /**
   * Проверяет NodeId по realtime allowlist.
   * Пустой `CPS_NODE_IDS` означает отсутствие ограничения.
   * @param nodeId - числовой идентификатор CPS node
   * @returns `true`, если событие разрешено индексировать
   */
  private isNodeAllowed(nodeId: bigint): boolean {
    return (
      this.configuredNodeIds.size === 0 ||
      this.configuredNodeIds.has(nodeId.toString(10))
    );
  }
}
