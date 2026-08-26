import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { decodeCpsPayloadCid } from './cps-payload.decoder.js';
import { readCpsNodeAt } from './cps-node.reader.js';
import { RobonomicsService } from './robonomics.service.js';

/** Создаёт anchors из текущего финализированного состояния настроенных CPS NodeId. */
@Injectable()
export class CpsSnapshotService implements OnModuleInit {
  private readonly logger = new Logger(CpsSnapshotService.name);

  /** Создаёт сервис snapshot CPS-узлов. */
  constructor(
    private readonly config: ConfigService,
    private readonly robonomics: RobonomicsService,
    private readonly cpsAnchorRepo: CpsAnchorRepository,
  ) {}

  /** Запускает начальный snapshot без блокировки инициализации приложения. */
  onModuleInit(): void {
    if (!this.config.get<boolean>('cps.enabled', false)) return;
    void this.snapshot().catch((error: unknown) => {
      this.logger.error(
        'CPS snapshot failed',
        error instanceof Error ? error.stack : String(error),
      );
    });
  }

  /**
   * Читает настроенные NodeId в одном финализированном состоянии и ставит payload в очередь.
   * @returns число обнаруженных payload
   */
  async snapshot(): Promise<number> {
    const nodeIds = this.config.get<string[]>('cps.nodeIds', []);
    if (nodeIds.length === 0) {
      this.logger.warn('CPS snapshot enabled, but CPS_NODE_IDS is empty');
      return 0;
    }
    const api = await this.robonomics.getApi();
    const blockHash = await api.rpc.chain.getFinalizedHead();
    const header = await api.rpc.chain.getHeader(blockHash);
    const block = header.number.toNumber();
    let queued = 0;
    for (const nodeId of nodeIds) {
      const node = await readCpsNodeAt(api, blockHash, nodeId);
      if (!node?.payload) {
        this.logger.debug(
          `Snapshot block ${block}: CPS node ${nodeId} has no payload`,
        );
        continue;
      }
      const cid = decodeCpsPayloadCid(node.payload);
      await this.cpsAnchorRepo.upsertAnchor({
        nodeId,
        block,
        cid,
        owner: node.owner,
      });
      queued += 1;
      this.logger.debug(
        `Snapshot block ${block}: queued CPS node ${nodeId} payload ${cid}`,
      );
    }
    return queued;
  }
}
