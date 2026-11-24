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
 */
export default registerAs('govStations', () => ({
  enabled: process.env.GOV_STATIONS_ENABLED === 'true',
  sources: (process.env.GOV_STATIONS_SOURCES || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  pollInterval: int(process.env.GOV_STATIONS_POLL_MS, 15 * 60_000),
  timeoutMs: int(process.env.GOV_STATIONS_TIMEOUT_MS, 30_000),
}));
