import type { GovReading } from '../database/repositories/gov-measurement.repository.js';
import type { StoredGovStation } from '../database/repositories/gov-station.repository.js';
import { toMapUnits } from './projection.js';
import type { GovSource } from './sources/types.js';

export interface FeedMarker {
  id: string;
  name: string;
  kind: string;
  lat: number;
  lng: number;
  operator?: string;
  /** End of the newest hour in the window, epoch seconds */
  timestamp: number;
  /** That hour, in the map's units (PM μg/m³, NO₂/O₃ ppb, CO ppm) */
  latest: Record<string, number>;
  /** Highest hour in the window per quantity: what colours a marker for a past day */
  max: Record<string, number>;
}

/** Stations of one area with their readings in a window → markers; a station without a reading is left out. */
export function feedMarkers(
  source: Pick<GovSource, 'gasUnit'>,
  stations: StoredGovStation[],
  readings: GovReading[],
): FeedMarker[] {
  const byStation = new Map<string, GovReading[]>();
  for (const r of readings) {
    const list = byStation.get(r.station_id);
    if (list) list.push(r);
    else byStation.set(r.station_id, [r]);
  }
  const out: FeedMarker[] = [];
  for (const st of stations) {
    const rows = byStation.get(st.id);
    if (!rows?.length) continue;
    const last = rows.reduce((a, b) => (b.timestamp > a.timestamp ? b : a));
    const max: Record<string, number> = {};
    for (const r of rows) {
      for (const [k, v] of Object.entries(toMapUnits(source, r.values))) {
        if (!(k in max) || v > max[k]) max[k] = v;
      }
    }
    const latest = toMapUnits(source, last.values);
    if (!Object.keys(max).length) continue;
    out.push({
      id: st.id,
      name: st.name,
      kind: st.kind,
      lat: st.lat,
      lng: st.lng,
      ...(st.operator ? { operator: st.operator } : {}),
      timestamp: last.timestamp,
      latest,
      max,
    });
  }
  return out;
}
