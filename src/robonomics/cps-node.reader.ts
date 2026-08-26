import type { ApiPromise } from '@polkadot/api';
import type { Codec } from '@polkadot/types/types';

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
    at(blockHash: Codec, nodeId: unknown): Promise<CpsNodeOption>;
  };
}

export interface CpsNodeState {
  readonly owner?: string;
  readonly payload: Uint8Array | null;
}

/**
 * Читает CPS node в точно указанном состоянии чейна.
 * @param api - подключённый API Robonomics
 * @param blockHash - хеш состояния для чтения
 * @param nodeId - числовой NodeId или его SCALE-кодек
 * @returns текущее состояние node либо null, если node отсутствует
 */
export async function readCpsNodeAt(
  api: ApiPromise,
  blockHash: Codec,
  nodeId: unknown,
): Promise<CpsNodeState | null> {
  const cpsQuery = (api.query as unknown as { cps: CpsStorageQuery }).cps;
  const nodeOption = await cpsQuery.nodes.at(blockHash, nodeId);
  if (nodeOption.isNone) return null;
  const node = nodeOption.unwrap();
  const payloadOption = node.get('payload') as CpsPayloadOption | undefined;
  const owner = node.get('owner')?.toString();
  return {
    owner,
    payload:
      !payloadOption || payloadOption.isNone
        ? null
        : payloadOption.unwrap().toU8a(true),
  };
}
