import { CID } from 'multiformats/cid';

/**
 * Sensor social profile — wire formats shared by the indexer, the pin queue and the API.
 *
 * On chain (Robonomics CPS): the owner keeps one node per sensor inside their own Scope.
 *   meta    = UTF-8 JSON {"t":"ss.profile","v":1,"sensor":"<SS58 address>"}
 *   payload = binary CID of profile.json
 * On IPFS: profile.json, ERC-721-like —
 *   {"v":1,"sensor":"<SS58>","description":"…","images":["ipfs://<cid>", …]}
 * Photos are pulled by our Kubo over bitswap from the phone that published them.
 */

export const PROFILE_META_TYPE = 'ss.profile';
export const PROFILE_VERSION = 1;

export interface ProfileLimits {
  readonly maxDescriptionChars: number;
  readonly maxImages: number;
}

export const DEFAULT_PROFILE_LIMITS: ProfileLimits = {
  maxDescriptionChars: 500,
  maxImages: 3,
};

export interface ProfileDocument {
  readonly description: string;
  readonly images: string[];
}

export class ProfileFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = ProfileFormatError.name;
  }
}

// SS58 addresses on Robonomics are base58, 47–48 chars; keep the check loose but bounded.
const SS58_RE = /^[1-9A-HJ-NP-Za-km-z]{46,50}$/;

/** Parses CPS node meta; returns the sensor address or null when this is not a profile node. */
export function parseProfileMeta(meta: Uint8Array | null): string | null {
  if (!meta || meta.byteLength === 0 || meta.byteLength > 1024) return null;
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(meta));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (d.t !== PROFILE_META_TYPE || d.v !== PROFILE_VERSION) return null;
  if (typeof d.sensor !== 'string' || !SS58_RE.test(d.sensor)) return null;
  return d.sensor;
}

/** Normalises "ipfs://<cid>" or "<cid>" to a CIDv1 string, or throws. */
export function parseImageRef(ref: unknown): string {
  if (typeof ref !== 'string')
    throw new ProfileFormatError('image is not a string');
  const raw = ref.startsWith('ipfs://') ? ref.slice('ipfs://'.length) : ref;
  if (raw.includes('/'))
    throw new ProfileFormatError('image path is not allowed');
  try {
    return CID.parse(raw).toV1().toString();
  } catch {
    throw new ProfileFormatError(`image is not a CID: ${raw.slice(0, 80)}`);
  }
}

/** Validates profile.json bytes for the sensor named in the node meta. */
export function parseProfileDocument(
  bytes: Uint8Array,
  sensor: string,
  limits: ProfileLimits = DEFAULT_PROFILE_LIMITS,
): ProfileDocument {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new ProfileFormatError('profile.json is not valid UTF-8 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new ProfileFormatError('profile.json is not an object');
  }
  const d = data as Record<string, unknown>;
  if (d.v !== PROFILE_VERSION)
    throw new ProfileFormatError('unsupported profile version');
  if (d.sensor !== sensor)
    throw new ProfileFormatError('profile.json names another sensor');

  const description = d.description ?? '';
  if (typeof description !== 'string')
    throw new ProfileFormatError('description is not a string');
  if ([...description].length > limits.maxDescriptionChars) {
    throw new ProfileFormatError('description is too long');
  }

  const rawImages = d.images ?? [];
  if (!Array.isArray(rawImages))
    throw new ProfileFormatError('images is not an array');
  if (rawImages.length > limits.maxImages)
    throw new ProfileFormatError('too many images');
  const images = [...new Set(rawImages.map(parseImageRef))];

  return { description: description.trim(), images };
}

/** Decodes a CPS payload that must be a binary CID. */
export function decodeProfilePayload(payload: Uint8Array): string {
  try {
    return CID.decode(payload).toV1().toString();
  } catch {
    throw new ProfileFormatError('payload is not a binary CID');
  }
}
