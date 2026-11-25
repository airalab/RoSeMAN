import { registerAs } from '@nestjs/config';

function int(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Government stations: reference monitors of national air-quality networks, read from their
 * public sites and served to the map next to the sensors. Optional module.
 *
 * GOV_STATIONS_ENABLED=true runs the fetcher (one instance is enough); the read API
 * (GET /api/v2/gov/stations) goes with API_ENABLED and serves whatever the fetcher stored.
 * GOV_STATIONS_SOURCES picks the sources by id, comma separated (default: all known).
 * FEEDS_MONGODB_URI is their own database; GOV_STATIONS_LEGACY_PROJECTION=true keeps the old copy in measurements.
 */
export default registerAs('govStations', () => ({
  enabled: process.env.GOV_STATIONS_ENABLED === 'true',
  sources: (process.env.GOV_STATIONS_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  pollInterval: int(process.env.GOV_STATIONS_POLL_MS, 15 * 60_000),
  timeoutMs: int(process.env.GOV_STATIONS_TIMEOUT_MS, 30_000),
  /** Database of the feeds (src/database/feeds-connection.ts); empty = the main database. */
  mongodbUri: process.env.FEEDS_MONGODB_URI || '',
  /**
   * Also write every hour into measurements as a regular sensor (projection.ts), the way the map read
   * government stations before /api/v2/feeds. Off by default; on only while an old map is still served.
   */
  legacyProjection: process.env.GOV_STATIONS_LEGACY_PROJECTION === 'true',
}));
