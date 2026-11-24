import { GOV_SOURCES } from './sources/index.js';

const PREFIXES = GOV_SOURCES.map((s) => ({ id: s.id, prefix: `${s.id}-` }));

/** The government source whose station id this is ("de-uba-21" → "de-uba"), or null. */
export function govSourceOf(sensorId: string): string | null {
  return PREFIXES.find((p) => sensorId.startsWith(p.prefix))?.id ?? null;
}

/**
 * Sensor ids of government stations ("de-uba-21") belong to the gov-stations module alone. A sensor
 * from any other path (datalog, CPS) with such an id would mix its readings into a station's charts
 * and borrow its name on the map, so writes under these ids are accepted only with source_type 'gov'.
 */
export function isReservedGovId(sensorId: string): boolean {
  return govSourceOf(sensorId) !== null;
}

/** True for a station of a source that is switched off (gov_sources): kept off the map. */
export function isHiddenGovId(
  sensorId: string,
  disabled: Set<string>,
): boolean {
  if (!disabled.size) return false;
  const source = govSourceOf(sensorId);
  return source !== null && disabled.has(source);
}
