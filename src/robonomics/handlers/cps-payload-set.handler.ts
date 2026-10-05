import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Codec } from '@polkadot/types/types';
import type { Event } from '@polkadot/types/interfaces';
import { CpsPayloadSource } from '../../common/constants/connectivity-storage.enum.js';
import { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import { parseCpsCompressionMeta } from '../cps-compression-meta.js';
import { decodeCpsPayloadReference } from '../cps-payload.decoder.js';
import { isCpsNodeInSubtreesAt, readCpsNodeAt } from '../cps-node.reader.js';
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
  private readonly configuredRootNodeIds: ReadonlySet<string>;

  /**
   * Создаёт обработчик CPS-событий.
   * @param robonomics - подключение к Robonomics API
   * @param cpsAnchorRepo - идемпотентная очередь найденных anchors
   * @param config - конфигурация CPS и корни разрешённых поддеревьев
   */
  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly cpsAnchorRepo: CpsAnchorRepository,
    private readonly config: ConfigService,
  ) {
    this.configuredRootNodeIds = new Set(
      this.config.get<string[]>('cps.nodeIds', []),
    );
  }

  /**
   * Читает CPS node в состоянии блока события и ставит payload в очередь.
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
    const blockHash = await api.rpc.chain.getBlockHash(blockNum);
    const isAllowed = await isCpsNodeInSubtreesAt(
      api,
      blockHash,
      numericNodeId,
      this.configuredRootNodeIds,
    );
    if (!isAllowed) {
      this.logger.debug(
        `Block ${blockNum}: CPS node ${numericNodeId} is outside configured subtrees, skipping`,
      );
      return;
    }

    const node = await readCpsNodeAt(api, blockHash, nodeId);

    if (!node?.payload) {
      this.logger.debug(
        `Block ${blockNum}: CPS node ${numericNodeId} has no payload`,
      );
      return;
    }

    const reference = decodeCpsPayloadReference(node.payload);
    const wireFormat = parseCpsCompressionMeta(node.meta);
    if (reference.source === CpsPayloadSource.Ipfs) {
      await this.cpsAnchorRepo.upsertAnchor({
        nodeId: numericNodeId,
        block: blockNum,
        payloadSource: CpsPayloadSource.Ipfs,
        cid: reference.cid,
        owner: node.owner,
        wireFormat,
      });
      this.logger.debug(
        `Block ${blockNum}: queued CPS node ${numericNodeId} IPFS payload ${reference.cid}`,
      );
      return;
    }

    await this.cpsAnchorRepo.upsertAnchor({
      nodeId: numericNodeId,
      block: blockNum,
      payloadSource: CpsPayloadSource.Chain,
      chainPayload: reference.payload,
      owner: node.owner,
      wireFormat,
    });
    this.logger.debug(
      `Block ${blockNum}: queued CPS node ${numericNodeId} chain payload (${reference.payload.byteLength} bytes)`,
    );
  }
}
