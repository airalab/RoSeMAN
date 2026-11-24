import type { Model } from 'mongoose';
import type {
  Measurement,
  MeasurementDocument,
} from '../schemas/measurement.schema.js';
import type { SensorLatestDocument } from '../schemas/sensor-latest.schema.js';
import { MeasurementRepository } from './measurement.repository.js';

type LatestOp = {
  updateOne: {
    filter: { sensor_id: string };
    update: Array<{ $set: Record<string, unknown> }>;
    upsert: boolean;
  };
};

const m = (
  sensor_id: string,
  timestamp: number,
  extra: Partial<Measurement> = {},
): Measurement => ({
  sensor_id,
  model: 2,
  measurement: { pm10: 1 },
  timestamp,
  geo: { lat: 34.7, lng: 33 },
  ...extra,
});

describe('sensor_latest', () => {
  const measurementsWrite = jest.fn().mockResolvedValue({});
  const latestWrite = jest
    .fn<Promise<object>, [LatestOp[]]>()
    .mockResolvedValue({});
  const find = jest.fn();
  const repo = new MeasurementRepository(
    { bulkWrite: measurementsWrite } as unknown as Model<MeasurementDocument>,
    { bulkWrite: latestWrite, find } as unknown as Model<SensorLatestDocument>,
  );

  beforeEach(() => {
    latestWrite.mockClear();
    find.mockReset();
  });

  it('keeps one row per sensor, from the newest document of the batch', async () => {
    await repo.upsertMany([
      m('a', 100, { owner: 'o1' }),
      m('a', 300, { owner: 'o2', device_model: 'urban' }),
      m('a', 200),
      m('b', 50),
      m('c', 400, { model: 1 }), // not a sensor-data model: not on the map
    ]);
    const ops = latestWrite.mock.calls[0][0];
    expect(ops.map((o) => o.updateOne.filter.sensor_id)).toEqual(['a', 'b']);
    const set = ops[0].updateOne.update[0].$set;
    expect(ops[0].updateOne.upsert).toBe(true);
    // every field moves only when the batch is newer than what is stored
    expect(set.owner).toEqual({
      $cond: [
        { $gt: [300, { $ifNull: ['$timestamp', -1] }] },
        { $literal: 'o2' },
        '$owner',
      ],
    });
    expect(set.bundle).toEqual({
      $cond: [
        { $gt: [300, { $ifNull: ['$timestamp', -1] }] },
        { $literal: null },
        '$bundle',
      ],
    });
    expect(set.timestamp).toEqual({
      $max: [300, { $ifNull: ['$timestamp', -1] }],
    });
  });

  it('reads markers in the shape of the aggregation', async () => {
    find.mockReturnValue({
      lean: () =>
        Promise.resolve([
          {
            sensor_id: 'a',
            model: 2,
            geo: { lat: 1, lng: 2 },
            device_model: 'urban',
            owner: 'o',
            bundle: ['b'],
            timestamp: 9,
          },
          {
            sensor_id: 'g',
            model: 2,
            geo: { lat: 3, lng: 4 },
            device_model: 'gov',
            owner: null,
            bundle: null,
            donated_by: null,
            timestamp: 8,
          },
        ]),
    });
    await expect(repo.findMarkerSensorsLatest(0, 10)).resolves.toEqual([
      {
        sensor_id: 'a',
        model: 2,
        geo: { lat: 1, lng: 2 },
        donated_by: '',
        device_model: 'urban',
        owner: 'o',
        bundle: ['b'],
        timestamp: 9,
      },
      {
        sensor_id: 'g',
        model: 2,
        geo: { lat: 3, lng: 4 },
        donated_by: '',
        device_model: 'gov',
        owner: '',
        bundle: undefined,
        timestamp: 8,
      },
    ]);
  });
});
