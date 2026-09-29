import { CpsPayloadSource } from '../common/constants/connectivity-storage.enum.js';
import { MAX_CPS_CHAIN_PAYLOAD_BYTES } from '../common/constants/cps-payload.constants.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import { resolveCpsAnchorPayload } from './cps-anchor-payload.resolver.js';
import type { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { ProtocolBatchWireFormat } from './protocol/signed-envelope-batch-payload.decoder.js';

describe('resolveCpsAnchorPayload', () => {
  it('загружает CID старого anchor из IPFS с настроенным wire format', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const fetchBytes = jest.fn().mockResolvedValue(bytes);
    const anchor = {
      source_key: 'cps:1:cid',
      node_id: '1',
      block: 10,
      cid: 'QmLegacy',
    } as CpsAnchorDocument;

    await expect(
      resolveCpsAnchorPayload(
        anchor,
        { fetchBytes } as unknown as IpfsFetcherService,
        ProtocolBatchWireFormat.Zlib,
      ),
    ).resolves.toEqual({
      bytes,
      source: CpsPayloadSource.Ipfs,
      wireFormat: ProtocolBatchWireFormat.Zlib,
    });
    expect(fetchBytes).toHaveBeenCalledWith('QmLegacy');
  });

  it('возвращает chain bytes напрямую и всегда выбирает XZ', async () => {
    const chainPayload = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a]);
    const fetchBytes = jest.fn();
    const anchor = {
      source_key: 'cps:1:chain:hash',
      node_id: '1',
      block: 11,
      payload_source: CpsPayloadSource.Chain,
      chain_payload: chainPayload,
    } as CpsAnchorDocument;

    const result = await resolveCpsAnchorPayload(
      anchor,
      { fetchBytes } as unknown as IpfsFetcherService,
      ProtocolBatchWireFormat.Raw,
    );

    expect(result).toEqual({
      bytes: new Uint8Array(chainPayload),
      source: CpsPayloadSource.Chain,
      wireFormat: ProtocolBatchWireFormat.Xz,
    });
    expect(result.bytes).not.toBe(chainPayload);
    expect(fetchBytes).not.toHaveBeenCalled();
  });

  it('отклоняет chain payload сверх лимита до декодирования', async () => {
    const anchor = {
      source_key: 'cps:1:chain:hash',
      node_id: '1',
      block: 11,
      payload_source: CpsPayloadSource.Chain,
      chain_payload: Buffer.alloc(MAX_CPS_CHAIN_PAYLOAD_BYTES + 1),
    } as CpsAnchorDocument;

    await expect(
      resolveCpsAnchorPayload(
        anchor,
        { fetchBytes: jest.fn() } as unknown as IpfsFetcherService,
        ProtocolBatchWireFormat.Raw,
      ),
    ).rejects.toThrow(`exceeds ${MAX_CPS_CHAIN_PAYLOAD_BYTES} bytes`);
  });
});
