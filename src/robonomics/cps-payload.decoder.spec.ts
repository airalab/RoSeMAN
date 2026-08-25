import { CID } from 'multiformats/cid';
import {
  CpsPayloadDecodeError,
  decodeCpsPayloadCid,
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
