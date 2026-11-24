import {
  getJson,
  type GovSource,
  type GovStation,
  type GovStationReading,
} from './types.js';

/**
 * Germany — Umweltbundesamt (UBA), hourly data of the federal states' air quality networks:
 * https://www.umweltbundesamt.de/daten/luft/luftdaten — API https://luftdaten.umweltbundesamt.de/api/air-data/v3
 *
 * Stations: one list of every station ever run; the active ones (no "active to") are kept.
 * Readings: one request per pollutant, scope 2 = one-hour mean, for the last hours. The API gives
 * times in CET (UTC+1 all year, no summer time); the end of the hour is the reading's timestamp.
 */
const API = 'https://luftdaten.umweltbundesamt.de/api/air-data/v3';
const COMPONENTS: Record<string, string> = {
  '9': 'pm25',
  '1': 'pm10',
  '5': 'no2',
  '3': 'o3',
};
const HOURLY_SCOPE = 2;
const HOURS_BACK = 3;
const CET_OFFSET_S = 3600;

interface StationsDoc {
  indices: string[];
  data: Record<string, string[]>;
}
interface MeasuresDoc {
  data: Record<
    string,
    Record<string, [number, number, number | null, string, string]>
  >;
}

export function ubaStations(doc: StationsDoc): GovStation[] {
  const col = (name: string) => doc.indices.indexOf(name);
  const [cId, cName, cTo, cLng, cLat, cType] = [
    'station id',
    'station name',
    'station active to',
    'station longitude',
    'station latitude',
    'station type name',
  ].map(col);
  const out: GovStation[] = [];
  for (const row of Object.values(doc.data)) {
    if (row[cTo]) continue;
    const lat = Number(row[cLat]);
    const lng = Number(row[cLng]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    out.push({
      id: `de-uba-${row[cId]}`,
      name: row[cName],
      kind: (row[cType] || 'station').toLowerCase(),
      lat,
      lng,
    });
  }
  return out;
}

/** "2026-11-24 14:00:00" in CET → epoch seconds */
export const cetEpoch = (s: string): number =>
  Math.round(Date.parse(`${s.replace(' ', 'T')}Z`) / 1000) - CET_OFFSET_S;

export function ubaReadings(
  byComponent: Record<string, MeasuresDoc>,
): GovStationReading[] {
  const byKey = new Map<string, GovStationReading>();
  for (const [component, doc] of Object.entries(byComponent)) {
    const key = COMPONENTS[component];
    if (!key) continue;
    for (const [station, hours] of Object.entries(doc.data ?? {})) {
      for (const [, , value, end] of Object.values(hours)) {
        if (value === null || !Number.isFinite(value) || value < 0) continue;
        const id = `de-uba-${station}`;
        const timestamp = cetEpoch(end);
        const k = `${id}@${timestamp}`;
        const reading = byKey.get(k) ?? {
          station_id: id,
          timestamp,
          values: {},
        };
        reading.values[key] = value;
        byKey.set(k, reading);
      }
    }
  }
  return [...byKey.values()];
}

/** UBA counts hours 1–24 within a CET day: hour h is the hour that ends at h:00. */
function cetDayHour(epochS: number): { date: string; hour: number } {
  const t = new Date((epochS + CET_OFFSET_S) * 1000);
  const hour = t.getUTCHours();
  if (hour === 0) {
    const prev = new Date(t.getTime() - 86400_000);
    return { date: prev.toISOString().slice(0, 10), hour: 24 };
  }
  return { date: t.toISOString().slice(0, 10), hour };
}

export const germanyUba: GovSource = {
  id: 'de-uba',
  network: 'Umweltbundesamt, Germany',
  publisher:
    'Umweltbundesamt (German Environment Agency), air quality networks of the federal states',
  url: 'https://www.umweltbundesamt.de/daten/luft/luftdaten',
  country: 'DE',
  async fetchStations(timeoutMs: number): Promise<GovStation[]> {
    return ubaStations(
      await getJson<StationsDoc>(`${API}/stations/json?lang=en`, timeoutMs),
    );
  },
  async fetchLatest(timeoutMs: number): Promise<GovStationReading[]> {
    const nowS = Math.floor(Date.now() / 1000);
    const from = cetDayHour(nowS - HOURS_BACK * 3600);
    const to = cetDayHour(nowS);
    const byComponent: Record<string, MeasuresDoc> = {};
    // UBA answers 410 for a pollutant whose newest hour is not published yet: the other
    // pollutants still count, and the hour is read again on the next poll
    for (const component of Object.keys(COMPONENTS)) {
      try {
        byComponent[component] = await getJson<MeasuresDoc>(
          `${API}/measures/json?date_from=${from.date}&time_from=${from.hour}` +
            `&date_to=${to.date}&time_to=${to.hour}&component=${component}&scope=${HOURLY_SCOPE}`,
          timeoutMs,
        );
      } catch {
        byComponent[component] = { data: {} };
      }
    }
    return ubaReadings(byComponent);
  },
};
