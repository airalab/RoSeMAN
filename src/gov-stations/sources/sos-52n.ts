import {
  getJson,
  type GovSource,
  type GovStation,
  type GovStationReading,
} from './types.js';

/**
 * Networks published through the 52°North SOS REST API (/api/v1): Belgium's IRCEL-CELINE and the UK's
 * DEFRA UK-AIR. One request per pollutant returns every time series with its station, position and last
 * value, so stations and readings come from the same calls. The last value is the hourly mean of the hour
 * that ends at `timestamp` (ms). Pollutants are EEA vocabulary ids; mg/m³ is turned into μg/m³.
 */
const PHENOMENA: Record<string, string> = {
  '6001': 'pm25',
  '5': 'pm10',
  '8': 'no2',
  '7': 'o3',
  '10': 'co',
};
const MAX_AGE_S = 6 * 3600;

export interface SosSeries {
  uom?: string;
  lastValue?: { timestamp: number; value: number };
  station: {
    properties: { id: number; label: string };
    geometry?: { coordinates: [number, number, ...unknown[]] };
  };
}

export interface SosNetwork {
  /** Source id, also the station id prefix. */
  id: string;
  api: string;
  /** The API gives [lat, lng] instead of GeoJSON's [lng, lat] (UK-AIR does). */
  latFirst?: boolean;
  /** The station's name from a series label ("40AL01 - Linkeroever", "Toft Newton-Particulate…"). */
  nameOf(label: string): string;
}

export function sosStations(
  net: SosNetwork,
  series: SosSeries[],
): GovStation[] {
  const byId = new Map<string, GovStation>();
  for (const s of series) {
    // some UK-AIR series come without a geometry: no position, no marker
    const [x, y] = s.station?.geometry?.coordinates ?? [NaN, NaN];
    const [lat, lng] = net.latFirst ? [x, y] : [y, x];
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = `${net.id}-${s.station.properties.id}`;
    if (!byId.has(id)) {
      byId.set(id, {
        id,
        name: net.nameOf(s.station.properties.label),
        kind: 'station',
        lat,
        lng,
      });
    }
  }
  return [...byId.values()];
}

export function sosReadings(
  net: SosNetwork,
  byPhenomenon: Record<string, SosSeries[]>,
  nowS: number,
): GovStationReading[] {
  const byKey = new Map<string, GovStationReading>();
  for (const [phenomenon, series] of Object.entries(byPhenomenon)) {
    const key = PHENOMENA[phenomenon];
    for (const s of series) {
      const lv = s.lastValue;
      if (
        !key ||
        !lv ||
        !s.station ||
        !Number.isFinite(lv.value) ||
        lv.value < 0
      )
        continue;
      const timestamp = Math.round(lv.timestamp / 1000);
      if (nowS - timestamp > MAX_AGE_S) continue;
      const value = /^mg/i.test(s.uom ?? '') ? lv.value * 1000 : lv.value;
      const id = `${net.id}-${s.station.properties.id}`;
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
  net: SosNetwork,
  timeoutMs: number,
): Promise<Record<string, SosSeries[]>> {
  const out: Record<string, SosSeries[]> = {};
  for (const phenomenon of Object.keys(PHENOMENA)) {
    out[phenomenon] = await getJson<SosSeries[]>(
      `${net.api}/timeseries?phenomenon=${phenomenon}&expanded=true`,
      timeoutMs,
    );
  }
  return out;
}

export function sosSource(
  net: SosNetwork,
  about: Pick<GovSource, 'network' | 'publisher' | 'url' | 'country'>,
): GovSource {
  return {
    id: net.id,
    ...about,
    async fetchStations(timeoutMs: number): Promise<GovStation[]> {
      return sosStations(
        net,
        Object.values(await seriesByPhenomenon(net, timeoutMs)).flat(),
      );
    },
    async fetchLatest(timeoutMs: number): Promise<GovStationReading[]> {
      return sosReadings(
        net,
        await seriesByPhenomenon(net, timeoutMs),
        Math.floor(Date.now() / 1000),
      );
    },
  };
}
