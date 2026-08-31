import { MeasurementSchema } from './measurement.schema.js';

describe('MeasurementSchema', () => {
  it('разрешает сохранять measurement без geo', () => {
    expect(MeasurementSchema.path('geo')?.isRequired).toBeFalsy();
  });
});
