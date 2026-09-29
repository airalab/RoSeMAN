import { CID } from 'multiformats/cid';
import { CpsPayloadSource } from '../common/constants/connectivity-storage.enum.js';
import {
  CpsPayloadDecodeError,
  decodeCpsPayloadCid,
  decodeCpsPayloadReference,
} from './cps-payload.decoder.js';

const TEST_CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

describe('decodeCpsPayloadCid', () => {
  it('декодирует фактические бинарные CID bytes alpha-anchor', () => {
    const cid = CID.parse(TEST_CID);

    expect(decodeCpsPayloadCid(cid.bytes)).toBe(TEST_CID);
  });

  it('fail-closed отклоняет UTF-8 CID из устаревшего README', () => {
    expect(() =>
      decodeCpsPayloadCid(new TextEncoder().encode(TEST_CID)),
    ).toThrow(CpsPayloadDecodeError);
  });

  it('не включает исходные байты в диагностическую ошибку', () => {
    expect(() => decodeCpsPayloadCid(new Uint8Array([1, 2, 3]))).toThrow(
      'CPS payload does not contain a binary IPFS CID',
    );
  });
});

describe('decodeCpsPayloadReference', () => {
  it('распознаёт бинарный CID как ссылку на IPFS', () => {
    const cid = CID.parse(TEST_CID);

    expect(decodeCpsPayloadReference(cid.bytes)).toEqual({
      source: 'ipfs',
      cid: TEST_CID,
    });
  });

  it('возвращает независимую копию прямого chain payload', () => {
    const payload = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a]);
    const reference = decodeCpsPayloadReference(payload);

    expect(reference).toEqual({ source: 'chain', payload });
    if (reference.source === CpsPayloadSource.Chain) {
      expect(reference.payload).not.toBe(payload);
    }
  });
});
