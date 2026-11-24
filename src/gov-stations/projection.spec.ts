import { toSensorMeasurement } from './projection.js';
import { cyprusDli } from './sources/cyprus-dli.js';

const station = {
  id: 'cy-dli-nictra',
  name: 'Nicosia — traffic',
  kind: 'traffic',
  lat: 35.1519,
  lng: 33.3478,
};

describe('government station as a map sensor', () => {
  it('keeps PM in μg/m³ and converts gases to the map units at 20 °C', () => {
    const m = toSensorMeasurement(cyprusDli, station, {
      station_id: station.id,
      timestamp: 1795521600,
      values: {
        pm25: 10.8,
        pm10: 28.6,
        no2: 23.6,
        o3: 67.6,
        co: 274.6,
        so2: 4.1,
        nox: 35.6,
      },
    });
    expect(m).toMatchObject({
      sensor_id: 'cy-dli-nictra',
      model: 2,
      device_model: 'gov',
      source_type: 'gov',
      source_id: 'gov:cy-dli',
      geo: { lat: station.lat, lng: station.lng },
      timestamp: 1795521600,
      measurement: { pm25: 10.8, pm10: 28.6, no2: 12.3, o3: 33.9, co: 0.236 },
    });
    expect(m?.owner).toBeUndefined();
    expect(m?.measurement).not.toHaveProperty('so2');
  });

  it('skips an hour with nothing the map can show', () => {
    expect(
      toSensorMeasurement(cyprusDli, station, {
        station_id: station.id,
        timestamp: 1,
        values: { so2: 3 },
      }),
    ).toBeNull();
  });
});
