import { CID } from 'multiformats/cid';

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
