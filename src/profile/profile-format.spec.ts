import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';
import {
  decodeProfilePayload,
  parseProfileDocument,
  parseProfileMeta,
  ProfileFormatError,
} from './profile-format.js';

const SENSOR = '4TestSensorAddressForProfiLeSpecs1111111111111111';
const enc = (v: unknown) =>
  new TextEncoder().encode(typeof v === 'string' ? v : JSON.stringify(v));

async function cidOf(text: string): Promise<CID> {
  return CID.createV1(raw.code, await sha256.digest(enc(text)));
}

describe('parseProfileMeta', () => {
  it('returns the sensor of a profile node', () => {
    expect(
      parseProfileMeta(enc({ t: 'ss.profile', v: 1, sensor: SENSOR })),
    ).toBe(SENSOR);
  });

  it.each([
    ['empty', new Uint8Array()],
    ['null', null],
    ['not JSON', enc('zstd')],
    ['other type', enc({ t: 'measurements', v: 1, sensor: SENSOR })],
    ['other version', enc({ t: 'ss.profile', v: 2, sensor: SENSOR })],
    ['bad address', enc({ t: 'ss.profile', v: 1, sensor: '0xdeadbeef' })],
    ['array', enc([1, 2])],
    ['oversized', new Uint8Array(1025).fill(32)],
  ])('ignores %s meta', (_name, meta) => {
    expect(parseProfileMeta(meta as Uint8Array | null)).toBeNull();
  });
});

describe('parseProfileDocument', () => {
  it('accepts a full profile and normalises image refs to CIDv1', async () => {
    const a = await cidOf('a');
    const b = await cidOf('b');
    const doc = parseProfileDocument(
      enc({
        v: 1,
        sensor: SENSOR,
        description: '  Балкон, 5 этаж  ',
        images: [`ipfs://${a.toString()}`, b.toString()],
      }),
      SENSOR,
    );
    expect(doc).toEqual({
      description: 'Балкон, 5 этаж',
      images: [a.toString(), b.toString()],
    });
  });

  it('counts description length in characters, not bytes', () => {
    const ok = 'ж'.repeat(500);
    expect(
      parseProfileDocument(
        enc({ v: 1, sensor: SENSOR, description: ok }),
        SENSOR,
      ).description,
    ).toBe(ok);
    expect(() =>
      parseProfileDocument(
        enc({ v: 1, sensor: SENSOR, description: ok + 'ж' }),
        SENSOR,
      ),
    ).toThrow(ProfileFormatError);
  });

  it('de-duplicates images', async () => {
    const a = await cidOf('a');
    const doc = parseProfileDocument(
      enc({
        v: 1,
        sensor: SENSOR,
        images: [`ipfs://${a.toString()}`, a.toString()],
      }),
      SENSOR,
    );
    expect(doc.images).toEqual([a.toString()]);
  });

  it.each([
    [
      'another sensor',
      { v: 1, sensor: '4AnotherTestSensorAddressForSpecs222222222222222' },
    ],
    ['wrong version', { v: 2, sensor: SENSOR }],
    ['four images', { v: 1, sensor: SENSOR, images: ['x', 'y', 'z', 'w'] }],
    [
      'image with a path',
      { v: 1, sensor: SENSOR, images: ['ipfs://bafkreie/../etc'] },
    ],
    [
      'image not a CID',
      { v: 1, sensor: SENSOR, images: ['https://example.com/a.jpg'] },
    ],
    ['description not a string', { v: 1, sensor: SENSOR, description: 5 }],
  ])('rejects %s', (_name, doc) => {
    expect(() => parseProfileDocument(enc(doc), SENSOR)).toThrow(
      ProfileFormatError,
    );
  });

  it('rejects non-JSON', () => {
    expect(() => parseProfileDocument(enc('not json'), SENSOR)).toThrow(
      ProfileFormatError,
    );
  });
});

describe('decodeProfilePayload', () => {
  it('decodes a binary CID', async () => {
    const c = await cidOf('profile');
    expect(decodeProfilePayload(c.bytes)).toBe(c.toString());
  });

  it('rejects inline JSON payloads', () => {
    expect(() => decodeProfilePayload(enc({ description: 'x' }))).toThrow(
      ProfileFormatError,
    );
  });
});
