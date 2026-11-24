import type { Measurement } from '../database/schemas/measurement.schema.js';
import type {
  GovSource,
  GovStation,
  GovStationReading,
} from './sources/types.js';

/** `device_model` of a government station in `measurements`: the map shows it as a sensor of its own kind. */
export const GOV_DEVICE_MODEL = 'gov';

/**
 * μg/m³ → the units the map uses for gases (ppb for NO₂ and O₃, ppm for CO), at 20 °C and 1013 hPa as in
 * EU Directive 2008/50/EC: ppb = μg/m³ × 24.055 / M. SO₂, NO, NOx and benzene have no scale on the map
 * and stay in gov_measurements only. PM is in μg/m³ on both sides.
 */
const MOLAR_VOLUME_20C = 24.055;
const TO_MAP_UNITS: Record<string, (v: number) => number> = {
  pm25: (v) => v,
  pm10: (v) => v,
  no2: (v) => (v * MOLAR_VOLUME_20C) / 46.0055,
  o3: (v) => (v * MOLAR_VOLUME_20C) / 47.9982,
  co: (v) => (v * MOLAR_VOLUME_20C) / 28.0101 / 1000,
};

/** A source publishing gases in ppb (CO in ppm) already speaks the map's units. */
const FROM_PPB: Record<string, (v: number) => number> = Object.fromEntries(
  Object.keys(TO_MAP_UNITS).map((key) => [key, (v: number) => v]),
);

const round = (v: number, digits: number): number => Number(v.toFixed(digits));

/**
 * One hour of a government station as a regular `measurements` document, so that markers, the sensor card
 * and its charts show it the same way as an Altruist. No owner: a station belongs to no account.
 */
export function toSensorMeasurement(
  source: GovSource,
  station: GovStation,
  reading: GovStationReading,
): Measurement | null {
  const measurement: Record<string, number> = {};
  const units = source.gasUnit === 'ppb' ? FROM_PPB : TO_MAP_UNITS;
  for (const [key, convert] of Object.entries(units)) {
    const v = reading.values[key];
    if (Number.isFinite(v))
      measurement[key] = round(convert(v), key === 'co' ? 3 : 1);
  }
  if (!Object.keys(measurement).length) return null;
  return {
    sensor_id: station.id,
    model: 2,
    device_model: GOV_DEVICE_MODEL,
    source_type: 'gov',
    source_id: `gov:${source.id}`,
    geo: { lat: station.lat, lng: station.lng },
    measurement,
    timestamp: reading.timestamp,
  };
}
