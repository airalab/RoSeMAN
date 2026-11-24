import {
  getJson,
  type GovSource,
  type GovStation,
  type GovStationReading,
} from './types.js';

/**
 * Belgium — IRCEL-CELINE, the Belgian Interregional Environment Agency, for the networks of Flanders,
 * Wallonia and Brussels: https://www.irceline.be/ — SOS REST API https://geo.irceline.be/sos/api/v1
 *
 * One request per pollutant returns every time series with its station, position and last value, so
 * stations and readings come from the same calls. The last value is the hourly mean of the hour that
 * ends at `timestamp` (ms). Values arrive in the series' unit; mg/m³ is turned into μg/m³.
 */
const API = 'https://geo.irceline.be/sos/api/v1';
const PHENOMENA: Record<string, string> = {
  '6001': 'pm25',
  '5': 'pm10',
  '8': 'no2',
  '7': 'o3',
  '10': 'co',
};
const MAX_AGE_S = 6 * 3600;

export interface IrcelSeries {
  uom?: string;
  lastValue?: { timestamp: number; value: number };
  station: {
    properties: { id: number; label: string };
    geometry: { coordinates: [number, number, ...unknown[]] };
  };
}

/** "44RL01 - Roeselare" → "Roeselare" */
const placeOf = (label: string) =>
  label.replace(/^[^-]+-\s*/, '').trim() || label;

export function ircelStations(series: IrcelSeries[]): GovStation[] {
  const byId = new Map<string, GovStation>();
  for (const s of series) {
    const [lng, lat] = s.station.geometry.coordinates;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = `be-irceline-${s.station.properties.id}`;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: placeOf(s.station.properties.label),
        kind: 'station',
        lat,
        lng,
      });
    }
  }
  return [...byId.values()];
}

export function ircelReadings(
  byPhenomenon: Record<string, IrcelSeries[]>,
  nowS: number,
): GovStationReading[] {
  const byKey = new Map<string, GovStationReading>();
  for (const [phenomenon, series] of Object.entries(byPhenomenon)) {
    const key = PHENOMENA[phenomenon];
    for (const s of series) {
      const lv = s.lastValue;
      if (!key || !lv || !Number.isFinite(lv.value) || lv.value < 0) continue;
      const timestamp = Math.round(lv.timestamp / 1000);
      if (nowS - timestamp > MAX_AGE_S) continue;
      const value = /^mg/i.test(s.uom ?? '') ? lv.value * 1000 : lv.value;
      const id = `be-irceline-${s.station.properties.id}`;
      const k = `${id}@${timestamp}`;
      const reading = byKey.get(k) ?? { station_id: id, timestamp, values: {} };
      // several devices of one station measure the same pollutant: keep the first
      reading.values[key] ??= Number(value.toFixed(2));
      byKey.set(k, reading);
    }
  }
  return [...byKey.values()];
}

async function seriesByPhenomenon(
  timeoutMs: number,
): Promise<Record<string, IrcelSeries[]>> {
  const out: Record<string, IrcelSeries[]> = {};
  for (const phenomenon of Object.keys(PHENOMENA)) {
    out[phenomenon] = await getJson<IrcelSeries[]>(
      `${API}/timeseries?phenomenon=${phenomenon}&expanded=true`,
      timeoutMs,
    );
  }
  return out;
}

export const belgiumIrceline: GovSource = {
  id: 'be-irceline',
  publisher: 'IRCEL-CELINE, the Belgian Interregional Environment Agency',
  url: 'https://www.irceline.be/',
  country: 'BE',
  async fetchStations(timeoutMs: number): Promise<GovStation[]> {
    return ircelStations(
      Object.values(await seriesByPhenomenon(timeoutMs)).flat(),
    );
  },
  async fetchLatest(timeoutMs: number): Promise<GovStationReading[]> {
    return ircelReadings(
      await seriesByPhenomenon(timeoutMs),
      Math.floor(Date.now() / 1000),
    );
  },
};
