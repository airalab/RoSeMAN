import { ISO_NUMERIC_TO_ALPHA2, US_STATES } from './iso-codes.js';
import {
  getText,
  type GovSource,
  type GovStation,
  type GovStationReading,
} from './types.js';

/**
 * AirNow — the U.S. EPA's air quality system, with the monitors of state, local and tribal agencies,
 * Canada's provinces and U.S. embassies abroad: https://www.airnow.gov/ — public files at
 * https://files.airnowtech.org/airnow/today/
 *
 * Stations: Monitoring_Site_Locations_V2.dat, one row per site and parameter; active sites that measure
 * PM2.5 or PM10 are kept (the map is about dust: ozone-only sites would be markers without a colour).
 * Readings: HourlyData_<YYYYMMDDHH>.dat, one file per UTC hour, a row per site and parameter; the time in
 * a row is the start of the hour in UTC. Gases are in ppb (CO in ppm), as the map shows them. Data are
 * preliminary, as AirNow says of every hour it publishes.
 */
const BASE = 'https://files.airnowtech.org/airnow/today';
const PARAMETERS: Record<string, string> = {
  'PM2.5': 'pm25',
  PM10: 'pm10',
  OZONE: 'o3',
  NO2: 'no2',
  CO: 'co',
};
const HOURS_BACK = 3;

const fields = (line: string) => line.split('|').map((f) => f.trim());

/** "QUEBEC - CHARLESBOUR" → "Quebec - Charlesbour": AirNow names are often all capitals. */
const tidy = (name: string) =>
  name === name.toUpperCase()
    ? name.toLowerCase().replace(/(^|[\s\-/(])\p{L}/gu, (c) => c.toUpperCase())
    : name;

export function airnowStations(text: string): GovStation[] {
  const [head, ...rows] = text.split(/\r?\n/);
  const col = Object.fromEntries(fields(head).map((name, i) => [name, i]));
  const byId = new Map<string, GovStation>();
  for (const line of rows) {
    const f = fields(line);
    if (f.length < 16 || f[col.Status] !== 'Active') continue;
    if (!['PM2.5', 'PM10'].includes(f[col.Parameter])) continue;
    const lat = Number(f[col.Latitude]);
    const lng = Number(f[col.Longitude]);
    if (!f[col.Latitude] || !Number.isFinite(lat) || !Number.isFinite(lng))
      continue;
    if (lat === 0 && lng === 0) continue;
    const id = `us-airnow-${f[col.FullAQSID]}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      name: tidy(f[col.SiteName]),
      kind: 'station',
      lat,
      lng,
      operator: f[col.AgencyName] || undefined,
      region: regionOf(f[col.FullAQSID], f[col.StateAbbreviation]),
    });
  }
  const stations = [...byId.values()];
  fillUsStates(stations);
  return stations;
}

/**
 * The map visitor's unit of choice: a U.S. state ("US-CA"), else the country ("CA", "TH", "KE"). The country
 * is the first three digits of the full AQS id — ISO 3166 numeric; CountryFIPS uses another code list.
 */
function regionOf(fullAqsid: string, state: string): string | undefined {
  const country = ISO_NUMERIC_TO_ALPHA2.get(fullAqsid.slice(0, 3));
  if (country === 'US' && state in US_STATES) return `US-${state}`;
  return country;
}

/** Farther than this from every U.S. station with a state, a station stays in "US" as a whole. */
const NEAREST_STATE_KM = 300;

/**
 * About one U.S. site in eight has no state (temporary smoke monitors, tribal networks): it takes the state
 * of the nearest site that has one. A visitor who switched a state on expects every station in it.
 */
function fillUsStates(stations: GovStation[]): void {
  const known = stations.filter((s) => s.region?.startsWith('US-'));
  for (const st of stations) {
    if (st.region !== 'US') continue;
    let best: GovStation | null = null;
    let bestKm = NEAREST_STATE_KM;
    for (const k of known) {
      const km = distanceKm(st, k);
      if (km < bestKm) [best, bestKm] = [k, km];
    }
    if (best) st.region = best.region;
  }
}

function distanceKm(a: GovStation, b: GovStation): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

/**
 * Rows of one hourly file → readings of known stations. A row names its site by the 12-digit full id or
 * by the 9-digit AQSID, which is the full id without its 3-digit country code; an AQSID shared by two
 * known stations is ambiguous and skipped.
 */
export function airnowReadings(
  text: string,
  known: Set<string>,
): GovStationReading[] {
  const PREFIX = 'us-airnow-';
  const byAqsid = new Map<string, string | null>();
  for (const id of known) {
    const aqsid = id.slice(-9);
    byAqsid.set(aqsid, byAqsid.has(aqsid) ? null : id);
  }
  const resolve = (site: string) =>
    known.has(PREFIX + site) ? PREFIX + site : (byAqsid.get(site) ?? null);
  const byKey = new Map<string, GovStationReading>();
  for (const line of text.split(/\r?\n/)) {
    const f = fields(line);
    if (f.length < 8) continue;
    const key = PARAMETERS[f[5]];
    const value = Number(f[7]);
    if (!key || !f[7] || !Number.isFinite(value) || value < 0) continue;
    const id = resolve(f[2]);
    const m = /^(\d\d)\/(\d\d)\/(\d\d)$/.exec(f[0]);
    const t = /^(\d\d):00$/.exec(f[1]);
    if (!id || !m || !t) continue;
    const start =
      Date.UTC(
        2000 + Number(m[3]),
        Number(m[1]) - 1,
        Number(m[2]),
        Number(t[1]),
      ) / 1000;
    const timestamp = start + 3600;
    const k = `${id}@${timestamp}`;
    const reading = byKey.get(k) ?? { station_id: id, timestamp, values: {} };
    reading.values[key] ??= value;
    byKey.set(k, reading);
  }
  return [...byKey.values()];
}

/** File names of the last few UTC hours, the newest first: "HourlyData_2026112414.dat". */
export function hourlyFiles(nowMs: number, hours = HOURS_BACK): string[] {
  return Array.from({ length: hours }, (_, i) => {
    const d = new Date(nowMs - (i + 1) * 3600_000);
    const p = (n: number) => String(n).padStart(2, '0');
    return `HourlyData_${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}.dat`;
  });
}

export const usAirnow: GovSource = {
  id: 'us-airnow',
  network: 'AirNow, U.S. EPA',
  publisher:
    'AirNow, U.S. EPA, with state, local and tribal agencies, Canadian provinces and U.S. embassies',
  url: 'https://www.airnow.gov/',
  country: 'US',
  gasUnit: 'ppb',
  async fetchStations(timeoutMs: number): Promise<GovStation[]> {
    const text = await getText(
      `${BASE}/Monitoring_Site_Locations_V2.dat`,
      timeoutMs,
    );
    return text ? airnowStations(text) : [];
  },
  async fetchLatest(
    timeoutMs: number,
    stations: GovStation[],
  ): Promise<GovStationReading[]> {
    const known = new Set(stations.map((s) => s.id));
    const out: GovStationReading[] = [];
    for (const file of hourlyFiles(Date.now())) {
      // the newest hour appears some 20–40 min after it ends: a missing file is not an error
      const text = await getText(`${BASE}/${file}`, timeoutMs);
      if (text) out.push(...airnowReadings(text, known));
    }
    return out;
  },
};
