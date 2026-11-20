import type {
  MarkerSensorEntry,
  MeasurementRepository,
} from '../../database/repositories/measurement.repository.js';
import type { SensorRepository } from '../../database/repositories/sensor.repository.js';
import { SensorService } from './sensor.service.js';

function entry(
  sensor_id: string,
  device_model: string,
  owner: string,
  bundle?: string[],
): MarkerSensorEntry {
  return {
    sensor_id,
    model: 2,
    geo: { lat: 0, lng: 0 },
    donated_by: '',
    device_model,
    owner,
    timestamp: 1,
    ...(bundle ? { bundle } : {}),
  };
}

function markers(sensors: MarkerSensorEntry[]) {
  const service = new SensorService(
    {
      findMarkerSensorsInRange: jest.fn().mockResolvedValue(sensors),
    } as unknown as MeasurementRepository,
    {} as SensorRepository,
  );
  return service.getMarkerSensorList(0, 10);
}

describe('SensorService.getMarkerSensorList', () => {
  it('CPS: бандл берётся из дерева, два бандла одного владельца не сливаются', async () => {
    const result = await markers([
      entry('u1', 'urban', '4Owner', ['i1']),
      entry('i1', 'insight', '4Owner', ['u1']),
      entry('u2', 'urban', '4Owner', ['i2']),
      entry('i2', 'insight', '4Owner', ['u2']),
    ]);

    expect(result.map((m) => [m.sensor_id, m.sensors])).toEqual([
      ['u1', [{ sensor_id: 'i1', device_model: 'insight' }]],
      ['u2', [{ sensor_id: 'i2', device_model: 'insight' }]],
    ]);
    expect(result[0]).not.toHaveProperty('bundle');
  });

  it('CPS: insight без urban в своём бандле остаётся маркером, даже если у владельца есть urban', async () => {
    const result = await markers([
      entry('u1', 'urban', '4Owner', []),
      entry('i9', 'insight', '4Owner', []),
    ]);

    expect(result.map((m) => m.sensor_id)).toEqual(['u1', 'i9']);
    expect(result[0].sensors).toEqual([]);
  });

  it('datalog без бандла группируется по владельцу, как раньше', async () => {
    const result = await markers([
      entry('a', 'urban', '4Old'),
      entry('b', 'insight', '4Old'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].sensors).toEqual([
      { sensor_id: 'b', device_model: 'insight' },
    ]);
  });
});
