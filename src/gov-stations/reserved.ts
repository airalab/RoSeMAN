import { GOV_SOURCES } from './sources/index.js';

const PREFIXES = GOV_SOURCES.map((s) => `${s.id}-`);

/**
 * Sensor ids of government stations ("de-uba-21") belong to the gov-stations module alone. A sensor
 * from any other path (datalog, CPS) with such an id would mix its readings into a station's charts
 * and borrow its name on the map, so writes under these ids are accepted only with source_type 'gov'.
 */
export function isReservedGovId(sensorId: string): boolean {
  return PREFIXES.some((p) => sensorId.startsWith(p));
}
