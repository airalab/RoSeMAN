import {
  getJson,
  type GovSource,
  type GovStation,
  type GovStationReading,
} from './types.js';

/**
 * Netherlands — Luchtmeetnet, the national air quality network run by RIVM with the provinces and
 * GGD regional services: https://www.luchtmeetnet.nl/ — open API https://api.luchtmeetnet.nl/open_api
 *
 * Stations: a paged list of codes, then one detail request per station for its position (once a day).
 * Readings: one paged request per pollutant for the last hours, all stations at once. Hourly means in
 * μg/m³; `timestamp_measured` is the end of the hour, in UTC.
 */
const API = 'https://api.luchtmeetnet.nl/open_api';
const FORMULAS: Record<string, string> = {
  PM25: 'pm25',
  PM10: 'pm10',
  NO2: 'no2',
  O3: 'o3',
};
const HOURS_BACK = 3;

interface Page<T> {
  pagination: { last_page: number; current_page: number };
  data: T[];
}
interface StationRow {
  number: string;
  location: string;
}
interface StationDetail {
  data: {
    type?: string;
    location?: string;
    municipality?: string;
    geometry?: { coordinates?: [number, number] };
  };
}
interface MeasurementRow {
  station_number: string;
  value: number;
  timestamp_measured: string;
  formula: string;
}

async function allPages<T>(url: string, timeoutMs: number): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const sep = url.includes('?') ? '&' : '?';
    const p = await getJson<Page<T>>(`${url}${sep}page=${page}`, timeoutMs);
    out.push(...p.data);
    if (page >= (p.pagination?.last_page ?? 1)) return out;
  }
}

/** Measurement rows of several pollutants → one reading per station and hour. */
export function rivmReadings(
  rows: MeasurementRow[],
  known: Set<string>,
): GovStationReading[] {
  const byKey = new Map<string, GovStationReading>();
  for (const r of rows) {
    const key = FORMULAS[r.formula];
    const id = `nl-rivm-${r.station_number}`;
    if (!key || !known.has(id) || !Number.isFinite(r.value)) continue;
    const timestamp = Math.round(Date.parse(r.timestamp_measured) / 1000);
    const k = `${id}@${timestamp}`;
    const reading = byKey.get(k) ?? { station_id: id, timestamp, values: {} };
    reading.values[key] = r.value;
    byKey.set(k, reading);
  }
  return [...byKey.values()];
}

export const netherlandsRivm: GovSource = {
  id: 'nl-rivm',
  publisher:
    'RIVM Luchtmeetnet, the national air quality network of the Netherlands',
  url: 'https://www.luchtmeetnet.nl/',
  country: 'NL',
  async fetchStations(timeoutMs: number): Promise<GovStation[]> {
    const rows = await allPages<StationRow>(`${API}/stations`, timeoutMs);
    const stations: GovStation[] = [];
    // One at a time: a hundred small requests once a day, without bursting their API
    for (const row of rows) {
      try {
        const d = (
          await getJson<StationDetail>(
            `${API}/stations/${row.number}`,
            timeoutMs,
          )
        ).data;
        const coords = d.geometry?.coordinates;
        if (
          !coords ||
          !Number.isFinite(coords[0]) ||
          !Number.isFinite(coords[1])
        )
          continue;
        const [lng, lat] = coords;
        const place = [d.municipality, d.location ?? row.location].filter(
          Boolean,
        );
        stations.push({
          id: `nl-rivm-${row.number}`,
          name: [...new Set(place)].join(', '),
          kind: (d.type || 'station').toLowerCase(),
          lat,
          lng,
        });
      } catch {
        // a station without details is skipped until the next daily refresh
      }
    }
    return stations;
  },
  async fetchLatest(
    timeoutMs: number,
    stations: GovStation[],
  ): Promise<GovStationReading[]> {
    const end = new Date();
    const start = new Date(end.getTime() - HOURS_BACK * 3600_000);
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    const rows: MeasurementRow[] = [];
    for (const formula of Object.keys(FORMULAS)) {
      rows.push(
        ...(await allPages<MeasurementRow>(
          `${API}/measurements?formula=${formula}&start=${iso(start)}&end=${iso(end)}`,
          timeoutMs,
        )),
      );
    }
    return rivmReadings(rows, new Set(stations.map((s) => s.id)));
  },
};
