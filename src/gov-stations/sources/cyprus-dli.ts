import type { GovSource, GovStation, GovStationReading } from './types.js';

/**
 * Cyprus — national air quality monitoring network of the Department of Labour Inspection (DLI),
 * Ministry of Labour, Welfare and Social Insurance: https://airquality.dli.mlsi.gov.cy/
 *
 * The front page carries the latest hourly value of every pollutant per station; there is no
 * public API, so the page is parsed. Coordinates are not on it: they come from the EEA station
 * metadata (EEA_stations_meta_table.parquet, Zenodo 17085064) where the station is listed there,
 * otherwise from the WAQI (aqicn) station map that republishes the same stations; where both list
 * a station they agree within ~150 m. Mari, Kalavasos and Ormidia (the last two owned by EAC)
 * are left out until their positions are confirmed.
 */
const STATIONS: Array<GovStation & { page: string }> = [
  {
    id: 'cy-dli-nictra',
    page: 'Nicosia - Traffic Station',
    name: 'Nicosia — traffic',
    kind: 'traffic',
    lat: 35.1519,
    lng: 33.3478,
  },
  {
    id: 'cy-dli-nicres',
    page: 'Nicosia - Residential Station',
    name: 'Nicosia — residential',
    kind: 'residential',
    lat: 35.1269,
    lng: 33.3317,
  },
  {
    id: 'cy-dli-limtra',
    page: 'Limassol - Traffic Station',
    name: 'Limassol — traffic',
    kind: 'traffic',
    lat: 34.70713,
    lng: 33.02262,
  },
  {
    id: 'cy-dli-lartra',
    page: 'Larnaca - Traffic Station',
    name: 'Larnaca — traffic',
    kind: 'traffic',
    lat: 34.91591,
    lng: 33.6275,
  },
  {
    id: 'cy-dli-paftra',
    page: 'Paphos - Traffic Station',
    name: 'Paphos — traffic',
    kind: 'traffic',
    lat: 34.71017,
    lng: 32.57307,
  },
  {
    id: 'cy-dli-partra',
    page: 'Paralimni - Traffic Station',
    name: 'Paralimni — traffic',
    kind: 'traffic',
    lat: 35.03584,
    lng: 33.96159,
  },
  {
    id: 'cy-dli-agmbac',
    page: 'Ayia Marina Xyliatou - Background Station',
    name: 'Ayia Marina Xyliatou — rural background (EMEP)',
    kind: 'background',
    lat: 35.038,
    lng: 33.0578,
  },
  {
    id: 'cy-dli-zygind',
    page: 'Zygi - Industrial Station',
    name: 'Zygi — industrial',
    kind: 'industrial',
    lat: 34.7333,
    lng: 33.3333,
    approx: true,
  },
];

const POLLUTANTS: Record<string, string> = {
  'PM₁₀': 'pm10',
  'PM₂.₅': 'pm25',
  'O₃': 'o3',
  'NO₂': 'no2',
  NO: 'no',
  NOx: 'nox',
  'SO₂': 'so2',
  CO: 'co',
  'C₆H₆': 'c6h6',
};

const LABELS = Object.keys(POLLUTANTS)
  .sort((a, b) => b.length - a.length)
  .map((k) => k.replace(/\./g, '\\.'))
  .join('|');
const VALUE_RE = new RegExp(
  `(${LABELS}):\\s*([0-9]+(?:\\.[0-9]+)?)\\s*μg/m³`,
  'g',
);
const UPDATED_RE = /^.*?Updated on: (\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})/;

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Wall-clock time in Cyprus → epoch seconds (EET/EEST from the tz database). */
export function cyprusEpoch(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
): number {
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Nicosia',
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(asUtc))
    .find((p) => p.type === 'timeZoneName')?.value;
  const m = name?.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  const offsetMin = m
    ? (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] || 0))
    : 120;
  return Math.round((asUtc - offsetMin * 60_000) / 1000);
}

/** The DLI front page → the latest reading of every known station found on it. */
export function parseDliPage(html: string): GovStationReading[] {
  const blocks = html
    .split(/class="[^"]*station-basic-info[^"]*"/)
    .slice(1)
    .map(decode);
  const out: GovStationReading[] = [];
  for (const st of STATIONS) {
    // The page repeats a station in several widgets. Its own block starts with its name and ends
    // with "Updated on: <time>"; whatever follows belongs to the next station on the page.
    let best: RegExpMatchArray | null = null;
    for (const b of blocks) {
      if (!b.replace(/^>\s*/, '').startsWith(st.page)) continue;
      const m = b.match(UPDATED_RE);
      if (m && (!best || m[0].length > best[0].length)) best = m;
    }
    if (!best) continue;
    const values: Record<string, number> = {};
    for (const [, label, v] of best[0].matchAll(VALUE_RE)) {
      values[POLLUTANTS[label]] ??= Number(v);
    }
    if (!Object.keys(values).length) continue;
    const [, d, mo, y, h, mi] = best.map(Number);
    out.push({
      station_id: st.id,
      timestamp: cyprusEpoch(y, mo, d, h, mi),
      values,
    });
  }
  return out;
}

export const cyprusDli: GovSource = {
  id: 'cy-dli',
  publisher:
    'Department of Labour Inspection, Ministry of Labour, Welfare and Social Insurance, Republic of Cyprus',
  url: 'https://airquality.dli.mlsi.gov.cy/',
  country: 'CY',
  stations: STATIONS.map(({ id, name, kind, lat, lng, approx }) => ({
    id,
    name,
    kind,
    lat,
    lng,
    approx,
  })),
  async fetchLatest(timeoutMs: number): Promise<GovStationReading[]> {
    // Their proxy cache answers 304 even to an unconditional request (seen 24.11.2026); a query
    // that changes every 15 min gets a fresh page and still lets the cache serve repeats.
    const slot = Math.floor(Date.now() / 900_000);
    const res = await fetch(`${this.url}?t=${slot}`, {
      headers: { 'User-Agent': 'RoSeMAN gov-stations (sensors.social)' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`DLI answered ${res.status}`);
    const readings = parseDliPage(await res.text());
    if (!readings.length)
      throw new Error('no stations parsed: the DLI page layout changed');
    return readings;
  },
};
