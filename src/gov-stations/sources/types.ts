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
  /** The agency that runs this station, where the source gathers several (AirNow: a state's department). */
  operator?: string;
}

/**
 * One hour of one station, values as the source publishes them: PM in μg/m³; gases in μg/m³, or in ppb
 * (CO in ppm) for a source with `gasUnit: 'ppb'`. `timestamp` is the end of the hour, epoch seconds.
 */
export interface GovStationReading {
  station_id: string;
  timestamp: number;
  values: Record<string, number>;
}

export interface GovSource {
  id: string;
  /** Short name of the network, shown with every station on the map ("AirNow, U.S. EPA"). */
  network: string;
  /** Who publishes the data, in full: the station card's source line. */
  publisher: string;
  url: string;
  /** ISO 3166 code, or "INT" for a network spanning countries. */
  country: string;
  /** How the source publishes NO₂, O₃ and CO: μg/m³ (EU networks, the default) or ppb with CO in ppm. */
  gasUnit?: 'ugm3' | 'ppb';
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

/** GET a text document (CSV, a pipe-delimited file) with our user agent and a timeout; null on 404. */
export async function getText(
  url: string,
  timeoutMs: number,
): Promise<string | null> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'RoSeMAN gov-stations (sensors.social)' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const u = new URL(url);
    throw new Error(`${u.host}${u.pathname} answered ${res.status}`);
  }
  return res.text();
}
