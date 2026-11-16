import { registerAs } from '@nestjs/config';

function int(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Sensor social profiles (CPS node per sensor → profile.json on IPFS → photos).
 * The pin queue runs where PROFILE_ENABLED=true and needs the Kubo RPC API;
 * the read API only needs Kubo for serving image bytes.
 */
export default registerAs('profile', () => ({
  enabled: process.env.PROFILE_ENABLED === 'true',
  kuboApiUrl: (process.env.PROFILE_KUBO_API_URL || 'http://ipfs:5001').replace(
    /\/+$/,
    '',
  ),
  pollInterval: int(process.env.PROFILE_POLL_INTERVAL, 5000),
  batchSize: int(process.env.PROFILE_BATCH_SIZE, 5),
  /** Each pin waits this long for the phone to hand over blocks. */
  pinTimeoutMs: int(process.env.PROFILE_PIN_TIMEOUT_MS, 60000),
  maxAttempts: int(process.env.PROFILE_MAX_ATTEMPTS, 10),
  retryBaseMs: int(process.env.PROFILE_RETRY_BASE_MS, 15000),
  maxProfileBytes: int(process.env.PROFILE_MAX_JSON_BYTES, 16 * 1024),
  maxImageBytes: int(process.env.PROFILE_MAX_IMAGE_BYTES, 1536 * 1024),
  maxImages: int(process.env.PROFILE_MAX_IMAGES, 3),
  maxDescriptionChars: int(process.env.PROFILE_MAX_DESCRIPTION, 500),
}));
