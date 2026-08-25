import { Injectable, Logger } from '@nestjs/common';
import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';
import type { Event } from '@polkadot/types/interfaces';
import { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import { decodeCpsPayloadCid } from '../cps-payload.decoder.js';
import type { ChainEventHandler } from '../interfaces/chain-event-handler.interface.js';
import { RobonomicsService } from '../robonomics.service.js';

interface CpsNodeIdCodec extends Codec {
  toBigInt(): bigint;
}

interface CpsPayloadCodec extends Codec {
  toU8a(isBare?: boolean): Uint8Array;
}

interface CpsPayloadOption extends Codec {
  readonly isNone: boolean;
  unwrap(): CpsPayloadCodec;
}

interface CpsNodeCodec extends Codec {
  get(key: string): Codec | undefined;
}

interface CpsNodeOption extends Codec {
  readonly isNone: boolean;
  unwrap(): CpsNodeCodec;
}

interface CpsStorageQuery {
  readonly nodes: {
    at(blockHash: Codec, nodeId: CpsNodeIdCodec): Promise<CpsNodeOption>;
  };
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

  /**
   * Создаёт обработчик CPS-событий.
   * @param robonomics - подключение к Robonomics API
   * @param cpsAnchorRepo - идемпотентная очередь найденных anchors
   */
  constructor(
    private readonly robonomics: RobonomicsService,
    private readonly cpsAnchorRepo: CpsAnchorRepository,
  ) {}

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

    const api = await this.robonomics.getApi();
    const payloadSet = (
      api.events as unknown as {
        readonly cps?: { readonly PayloadSet?: CpsEventMatcher };
      }
    ).cps?.PayloadSet;
    if (!payloadSet?.is(event)) return;

    const nodeId = event.data[0] as CpsNodeIdCodec;
    const owner = event.data[1].toString();
    const payload = await this.readPayloadAt(api, blockNum, nodeId);

    if (payload === null) {
      this.logger.debug(
        `Block ${blockNum}: CPS node ${nodeId.toBigInt()} has no payload`,
      );
      return;
    }

    const cid = decodeCpsPayloadCid(payload);
    await this.cpsAnchorRepo.upsertAnchor({
      nodeId: nodeId.toBigInt(),
      block: blockNum,
      cid,
      owner,
    });

    this.logger.debug(
      `Block ${blockNum}: queued CPS node ${nodeId.toBigInt()} payload ${cid}`,
    );
  }

  /**
   * Получает payload из исторического состояния именно на блоке события.
   * @param api - подключённый Robonomics API
   * @param blockNum - номер блока события
   * @param nodeId - SCALE-кодек числового NodeId
   * @returns чистые payload bytes либо null для отсутствующего payload
   */
  private async readPayloadAt(
    api: ApiPromise,
    blockNum: number,
    nodeId: CpsNodeIdCodec,
  ): Promise<Uint8Array | null> {
    const blockHash = await api.rpc.chain.getBlockHash(blockNum);
    const cpsQuery = (api.query as unknown as { cps: CpsStorageQuery }).cps;
    const nodeOption = await cpsQuery.nodes.at(blockHash, nodeId);
    if (nodeOption.isNone) return null;

    const payloadOption = nodeOption
      .unwrap()
      .get('payload') as CpsPayloadOption;
    if (!payloadOption || payloadOption.isNone) return null;

    return payloadOption.unwrap().toU8a(true);
  }
}
