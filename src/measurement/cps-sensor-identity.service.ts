import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import { BoundedCache } from '../common/utils/bounded-cache.js';
import {
  type CpsSensorPlacement,
  readCpsBundleAt,
  readCpsSensorPlacementAt,
} from '../robonomics/cps-node.reader.js';
import { RobonomicsService } from '../robonomics/robonomics.service.js';

const CACHE_SIZE = 10_000;
const NEGATIVE_TTL_MS = 60_000;

/** Владелец и бандл датчика, прочитанные из дерева CPS. */
export interface CpsSensorIdentity {
  /** SS58 identity родителя узла датчика либо адрес самого датчика. */
  readonly owner: string;
  /** true, если у родителя нет identity или ключ датчика не привязан. */
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

  constructor(
    config: ConfigService,
    private readonly robonomics: RobonomicsService,
  ) {
    this.ss58Prefix = config.get<number>('cps.sensorSs58Prefix', 32);
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
      owner: encodeAddress(sensorKey, this.ss58Prefix),
      ownerIsFallback: true,
      sensorNodeId: placement.sensorNodeId,
      parentNodeId: placement.parentNodeId,
      bundle,
    };
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
