import { CID } from 'multiformats/cid';
import { CpsPayloadSource } from '../common/constants/connectivity-storage.enum.js';

export interface CpsIpfsPayloadReference {
  readonly source: CpsPayloadSource.Ipfs;
  readonly cid: string;
}

export interface CpsChainPayloadReference {
  readonly source: CpsPayloadSource.Chain;
  readonly payload: Uint8Array;
}

export type CpsPayloadReference =
  | CpsIpfsPayloadReference
  | CpsChainPayloadReference;

/**
 * Ошибка декодирования бинарного payload CPS-узла.
 */
export class CpsPayloadDecodeError extends Error {
  /**
   * Создаёт безопасную ошибку без вывода исходных payload-байтов.
   * @param options - исходная ошибка multiformats
   */
  constructor(options?: ErrorOptions) {
    super('CPS payload does not contain a binary IPFS CID', options);
    this.name = CpsPayloadDecodeError.name;
  }
}

/**
 * Декодирует multicodec-байты CID из CPS payload alpha-релиза connectivity.
 * UTF-8 CID намеренно не принимается: фактический anchor отправляет CID.bytes.
 * @param payload - точные байты Option<BoundedVec<u8>> из CPS storage
 * @returns каноническая строка CID
 */
export function decodeCpsPayloadCid(payload: Uint8Array): string {
  try {
    return CID.decode(payload).toString();
  } catch (error) {
    throw new CpsPayloadDecodeError({ cause: error });
  }
}

/**
 * Определяет, содержит CPS payload бинарный CID или данные непосредственно.
 * Любые байты, не являющиеся полным бинарным CID, считаются chain payload;
 * их формат проверяется позднее специализированным batch-декодером.
 * @param payload - точные байты Option<BoundedVec<u8>> из CPS storage
 * @returns ссылка на IPFS либо копия непосредственно сохранённых байтов
 */
export function decodeCpsPayloadReference(
  payload: Uint8Array,
): CpsPayloadReference {
  try {
    return {
      source: CpsPayloadSource.Ipfs,
      cid: CID.decode(payload).toString(),
    };
  } catch {
    return { source: CpsPayloadSource.Chain, payload: payload.slice() };
  }
}
