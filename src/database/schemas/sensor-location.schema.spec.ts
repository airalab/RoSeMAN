import { SensorLocationStatus } from '../../common/constants/sensor-location-status.enum.js';
import { SensorLocationSchema } from './sensor-location.schema.js';

describe('SensorLocationSchema', () => {
  it('объявляет уникальный sensor_id и очередь геокодирования', () => {
    expect(SensorLocationSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ sensor_id: 1 }, { unique: true, background: true }],
        [{ geocoding_status: 1, updatedAt: 1 }, { background: true }],
        [{ geocoding_status: 1, city: 1, sensor_id: 1 }, { background: true }],
      ]),
    );
  });

  it('ограничивает состояние геокодирования стабильным enum', () => {
    const status = SensorLocationSchema.path('geocoding_status');
    expect(status.options.enum).toEqual(SensorLocationStatus);
  });

  it('хранит регион как необязательную строку', () => {
    expect(SensorLocationSchema.path('region').options).toMatchObject({
      type: String,
      default: null,
    });
  });
});
