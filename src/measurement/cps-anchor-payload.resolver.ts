import { CpsPayloadSource } from '../common/constants/connectivity-storage.enum.js';
import { MAX_CPS_CHAIN_PAYLOAD_BYTES } from '../common/constants/cps-payload.constants.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { ProtocolBatchWireFormat } from './protocol/signed-envelope-batch-payload.decoder.js';

export interface ResolvedCpsAnchorPayload {
  readonly bytes: Uint8Array;
  readonly source: CpsPayloadSource;
  readonly wireFormat: ProtocolBatchWireFormat;
}

/**
 * Возвращает transport bytes CPS anchor из IPFS либо непосредственно из чейна.
 * Старые документы без `payload_source` распознаются по наличию `cid`, поэтому
 * обновление не требует миграции уже накопленной очереди.
 * @param anchor - сохранённый CPS anchor
 * @param ipfsFetcher - загрузчик legacy IPFS payload
 * @param ipfsWireFormat - настроенный формат legacy IPFS batch
 * @returns точные transport bytes, источник и формат декодирования
 */
export async function resolveCpsAnchorPayload(
  anchor: CpsAnchorDocument,
  ipfsFetcher: IpfsFetcherService,
  ipfsWireFormat: ProtocolBatchWireFormat,
): Promise<ResolvedCpsAnchorPayload> {
  if (
    anchor.payload_source === CpsPayloadSource.Chain ||
    (anchor.payload_source === undefined && !anchor.cid)
  ) {
    const bytes = anchor.chain_payload;
    if (!bytes || bytes.byteLength === 0) {
      throw new Error('CPS chain anchor does not contain payload bytes');
    }
    if (bytes.byteLength > MAX_CPS_CHAIN_PAYLOAD_BYTES) {
      throw new Error(
        `CPS chain payload exceeds ${MAX_CPS_CHAIN_PAYLOAD_BYTES} bytes`,
      );
    }
    return {
      bytes: Uint8Array.from(bytes),
      source: CpsPayloadSource.Chain,
      wireFormat: ProtocolBatchWireFormat.Xz,
    };
  }

  if (!anchor.cid) {
    throw new Error('CPS IPFS anchor does not contain a CID');
  }
  return {
    bytes: await ipfsFetcher.fetchBytes(anchor.cid),
    source: CpsPayloadSource.Ipfs,
    wireFormat: ipfsWireFormat,
  };
}
