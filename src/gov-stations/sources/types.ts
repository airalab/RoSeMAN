/** A station of a national network, as shown on the map. */
export interface GovStation {
  /** Unique across sources: "<source id>-<the network's own station code>", e.g. "cy-dli-nictra". */
  id: string;
  name: string;
  /** traffic | residential | background | industrial | … as the network calls it, lower case */
  kind: string;
  lat: number;
  lng: number;
  /** Position known only roughly. */
  approx?: boolean;
}

/** One hour of one station, values in μg/m³. `timestamp` is the end of the hour, epoch seconds. */
export interface GovStationReading {
  station_id: string;
  timestamp: number;
  values: Record<string, number>;
}

export interface GovSource {
  id: string;
  /** Who publishes the data, named on the map next to every station. */
  publisher: string;
  url: string;
  country: string;
  /** The network's stations with positions; read about once a day. */
  fetchStations(timeoutMs: number): Promise<GovStation[]>;
  /** The last few published hours of every station (re-reading an hour is harmless). */
  fetchLatest(
    timeoutMs: number,
    stations: GovStation[],
  ): Promise<GovStationReading[]>;
}

/** GET a JSON document with our user agent and a timeout. */
export async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'RoSeMAN gov-stations (sensors.social)',
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const u = new URL(url);
    throw new Error(`${u.host}${u.pathname}${u.search} answered ${res.status}`);
  }
  return (await res.json()) as T;
}
