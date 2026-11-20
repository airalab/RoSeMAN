import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Codec } from '@polkadot/types/types';
import { encodeAddress } from '@polkadot/util-crypto';
import { BoundedCache } from '../common/utils/bounded-cache.js';
import {
  type CpsSensorPlacement,
  isCpsNodeInSubtreesAt,
  readCpsBundleAt,
  readCpsSensorPlacementAt,
} from '../robonomics/cps-node.reader.js';
import { RobonomicsService } from '../robonomics/robonomics.service.js';

const CACHE_SIZE = 10_000;
const NEGATIVE_TTL_MS = 60_000;

/** Почему конверт не принимается: датчик не зарегистрирован в нужном дереве. */
export enum CpsSensorRejection {
  /** Ключ не является identity ни одного узла CPS. */
  Unregistered = 'UNREGISTERED_SENSOR',
  /** Узел датчика вне поддеревьев CPS_NODE_IDS. */
  OutsideSubtree = 'SENSOR_OUTSIDE_SUBTREE',
}

/** Владелец и бандл датчика, прочитанные из дерева CPS. */
export interface CpsSensorIdentity {
  /** Причина отказа; при ней владелец и бандл не используются. */
  readonly rejection?: CpsSensorRejection;
  /** SS58 identity родителя узла датчика либо адрес самого датчика. */
  readonly owner: string;
  /** true, если у родителя узла датчика нет identity. */
  readonly ownerIsFallback: boolean;
  readonly sensorNodeId: string | null;
  readonly parentNodeId: string | null;
  /** hex-ключи соседей по бандлу без самого датчика. */
  readonly bundle: string[];
}

/**
 * Разрешает владельца и бандл датчика по его ключу:
 * `identityNode(ключ)` → `nodes(узел).parent` → `nodeIdentity(родитель)`,
 * бандл — `children(родитель)` без самого датчика.
 * Чтения идут в состоянии блока якоря, поэтому ключи кеша включают хеш блока:
 * одна партия читает дерево один раз на датчик и один раз на бандл.
 * Ключ без узла и узел вне поддеревьев CPS_NODE_IDS отклоняются: партия
 * может нести только датчики, зарегистрированные в дереве сети.
 * Ошибки RPC не кешируются и пробрасываются — якорь уходит в retry.
 */
@Injectable()
export class CpsSensorIdentityService {
  private readonly ss58Prefix: number;
  private readonly blockHashes = new BoundedCache<string>(CACHE_SIZE);
  private readonly placements = new BoundedCache<CpsSensorPlacement>(
    CACHE_SIZE,
  );
  private readonly bundles = new BoundedCache<string[]>(CACHE_SIZE);
  private readonly membership = new BoundedCache<boolean>(CACHE_SIZE);
  private readonly rootNodeIds: ReadonlySet<string>;

  constructor(
    config: ConfigService,
    private readonly robonomics: RobonomicsService,
  ) {
    this.ss58Prefix = config.get<number>('cps.sensorSs58Prefix', 32);
    this.rootNodeIds = new Set(config.get<string[]>('cps.nodeIds', []));
  }

  /**
   * @param block - номер финализированного блока якоря
   * @param sensorKey - 32-байтный ключ датчика из проверенного конверта
   */
  async resolve(
    block: number,
    sensorKey: Uint8Array,
  ): Promise<CpsSensorIdentity> {
    const blockHash = await this.blockHash(block);
    const sensorHex = Buffer.from(sensorKey).toString('hex');
    const placement = await this.placement(blockHash, sensorHex, sensorKey);
    const fallbackOwner = encodeAddress(sensorKey, this.ss58Prefix);

    if (placement.sensorNodeId === null) {
      return this.rejected(CpsSensorRejection.Unregistered, fallbackOwner);
    }
    if (!(await this.inSubtrees(blockHash, placement.sensorNodeId))) {
      return this.rejected(
        CpsSensorRejection.OutsideSubtree,
        fallbackOwner,
        placement,
      );
    }

    const bundle = placement.parentNodeId
      ? (await this.bundle(blockHash, placement.parentNodeId)).filter(
          (member) => member !== sensorHex,
        )
      : [];

    if (placement.ownerAccount) {
      return {
        owner: encodeAddress(placement.ownerAccount, this.ss58Prefix),
        ownerIsFallback: false,
        sensorNodeId: placement.sensorNodeId,
        parentNodeId: placement.parentNodeId,
        bundle,
      };
    }
    return {
      owner: fallbackOwner,
      ownerIsFallback: true,
      sensorNodeId: placement.sensorNodeId,
      parentNodeId: placement.parentNodeId,
      bundle,
    };
  }

  private rejected(
    rejection: CpsSensorRejection,
    owner: string,
    placement?: CpsSensorPlacement,
  ): CpsSensorIdentity {
    return {
      rejection,
      owner,
      ownerIsFallback: true,
      sensorNodeId: placement?.sensorNodeId ?? null,
      parentNodeId: placement?.parentNodeId ?? null,
      bundle: [],
    };
  }

  /** Узел датчика в поддеревьях CPS_NODE_IDS; пустой список — без ограничения. */
  private async inSubtrees(
    blockHash: string,
    sensorNodeId: string,
  ): Promise<boolean> {
    if (this.rootNodeIds.size === 0) return true;
    const key = `${blockHash}:${sensorNodeId}`;
    const cached = this.membership.get(key);
    if (cached !== undefined) return cached;
    const api = await this.robonomics.getApi();
    const inside = await isCpsNodeInSubtreesAt(
      api,
      { toString: () => blockHash } as unknown as Codec,
      sensorNodeId,
      this.rootNodeIds,
    );
    this.membership.set(key, inside);
    return inside;
  }

  private async blockHash(block: number): Promise<string> {
    const key = String(block);
    const cached = this.blockHashes.get(key);
    if (cached) return cached;
    const api = await this.robonomics.getApi();
    const hash = (await api.rpc.chain.getBlockHash(block)).toHex();
    this.blockHashes.set(key, hash);
    return hash;
  }

  private async placement(
    blockHash: string,
    sensorHex: string,
    sensorKey: Uint8Array,
  ): Promise<CpsSensorPlacement> {
    const key = `${blockHash}:${sensorHex}`;
    const cached = this.placements.get(key);
    if (cached) return cached;
    const api = await this.robonomics.getApi();
    const placement = await readCpsSensorPlacementAt(api, blockHash, sensorKey);
    this.placements.set(
      key,
      placement,
      placement.sensorNodeId === null ? NEGATIVE_TTL_MS : undefined,
    );
    return placement;
  }

  private async bundle(
    blockHash: string,
    parentNodeId: string,
  ): Promise<string[]> {
    const key = `${blockHash}:${parentNodeId}`;
    const cached = this.bundles.get(key);
    if (cached) return cached;
    const api = await this.robonomics.getApi();
    const members = (await readCpsBundleAt(api, blockHash, parentNodeId)).map(
      (member) => Buffer.from(member.account).toString('hex'),
    );
    this.bundles.set(key, members);
    return members;
  }
}
