/** A station of a national network, as shown on the map. */
export interface GovStation {
  /** Unique across sources, e.g. "cy-dli-nictra". */
  id: string;
  name: string;
  /** traffic | residential | background | industrial */
  kind: string;
  lat: number;
  lng: number;
  /** Position known only roughly. */
  approx?: boolean;
}

/** One hour of one station, values in μg/m³ as published. */
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
  stations: GovStation[];
  /** Reads the latest hour of every station from the source. */
  fetchLatest(timeoutMs: number): Promise<GovStationReading[]>;
}
