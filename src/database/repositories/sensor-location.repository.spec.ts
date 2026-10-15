import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import { SensorLocationStatus } from '../../common/constants/sensor-location-status.enum.js';
import type { SensorLocationDocument } from '../schemas/sensor-location.schema.js';
import { SensorLocationRepository } from './sensor-location.repository.js';

describe('SensorLocationRepository', () => {
  it('атомарно обновляет источник и сбрасывает адрес только при смене GPS', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const model = { updateOne } as unknown as Model<SensorLocationDocument>;
    const repository = new SensorLocationRepository(model);
    const sourceRecordId = new Types.ObjectId();
    const sourceRecordedAt = new Date('2026-10-15T10:00:00.000Z');

    await repository.upsertCandidates([
      {
        sensorId: 'sensor-a',
        geo: { lat: 53.2, lng: 50.1 },
        sourceRecordKey: 'cps:1:cid:0',
        sourceRecordId,
        sourceRecordedAt,
      },
    ]);

    const calls = updateOne.mock.calls as unknown as Array<
      [unknown, Array<{ $set: Record<string, unknown> }>, unknown]
    >;
    const [filter, pipeline, options] = calls[0];
    expect(filter).toEqual({ sensor_id: 'sensor-a' });
    expect(options).toEqual({ upsert: true });
    expect(pipeline).toHaveLength(1);
    expect(pipeline[0].$set).toHaveProperty('geo.$cond');
    expect(pipeline[0].$set).toHaveProperty('city.$cond');
    expect(pipeline[0].$set).toHaveProperty('region.$cond');
    expect(pipeline[0].$set).toHaveProperty('country.$cond');
    expect(pipeline[0].$set).toHaveProperty('geocoding_status.$cond');
    expect(pipeline[0].$set).toHaveProperty('source_record_key.$cond');
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('завершает геокодирование только для неизменившегося источника', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const model = { updateOne } as unknown as Model<SensorLocationDocument>;
    const repository = new SensorLocationRepository(model);
    const location = {
      _id: new Types.ObjectId(),
      sensor_id: 'sensor-a',
      geo: { lat: 53.2, lng: 50.1 },
      source_record_key: 'cps:1:cid:0',
    };

    await repository.markResolved(
      location,
      'Samara',
      'Samara Oblast',
      'Russia',
    );

    expect(updateOne).toHaveBeenCalledWith(
      {
        _id: location._id,
        source_record_key: location.source_record_key,
        $or: [
          { geocoding_status: SensorLocationStatus.Pending },
          {
            geocoding_status: SensorLocationStatus.Resolved,
            region: { $exists: false },
          },
        ],
      },
      {
        $set: {
          city: 'Samara',
          region: 'Samara Oblast',
          country: 'Russia',
          geocoding_status: SensorLocationStatus.Resolved,
        },
      },
    );
  });

  it('выбирает pending и старые resolved без поля региона', async () => {
    const exec = jest.fn().mockResolvedValue([]);
    const lean = jest.fn().mockReturnValue({ exec });
    const limit = jest.fn().mockReturnValue({ lean });
    const sort = jest.fn().mockReturnValue({ limit });
    const find = jest.fn().mockReturnValue({ sort });
    const model = { find } as unknown as Model<SensorLocationDocument>;
    const repository = new SensorLocationRepository(model);

    await repository.findPending(10);

    expect(find).toHaveBeenCalledWith(
      {
        $or: [
          { geocoding_status: SensorLocationStatus.Pending },
          {
            geocoding_status: SensorLocationStatus.Resolved,
            region: { $exists: false },
          },
        ],
      },
      { sensor_id: 1, geo: 1, source_record_key: 1 },
    );
  });

  it('группирует разрешённые города по странам и регионам', async () => {
    const exec = jest.fn().mockResolvedValue([
      {
        _id: { country: 'France', region: 'Ile-de-France' },
        cities: ['Paris'],
      },
      {
        _id: { country: 'Russia', region: '' },
        cities: ['Moscow'],
      },
      {
        _id: { country: 'Russia', region: 'Samara Oblast' },
        cities: ['Tolyatti', 'Samara'],
      },
    ]);
    const aggregate = jest.fn().mockReturnValue({ exec });
    const model = { aggregate } as unknown as Model<SensorLocationDocument>;
    const repository = new SensorLocationRepository(model);

    await expect(repository.getCitiesGrouped()).resolves.toEqual({
      France: { 'Ile-de-France': ['Paris'] },
      Russia: {
        '': ['Moscow'],
        'Samara Oblast': ['Samara', 'Tolyatti'],
      },
    });
    expect(aggregate).toHaveBeenCalledWith([
      {
        $match: {
          geocoding_status: SensorLocationStatus.Resolved,
          city: { $type: 'string', $ne: '' },
          region: { $type: 'string' },
          country: { $type: 'string', $ne: '' },
        },
      },
      {
        $group: {
          _id: { country: '$country', region: '$region' },
          cities: { $addToSet: '$city' },
        },
      },
      { $sort: { '_id.country': 1, '_id.region': 1 } },
    ]);
  });

  it('возвращает отсортированные сенсоры разрешённого города', async () => {
    const exec = jest
      .fn()
      .mockResolvedValue([
        { sensor_id: 'sensor-a' },
        { sensor_id: 'sensor-b' },
      ]);
    const lean = jest.fn().mockReturnValue({ exec });
    const sort = jest.fn().mockReturnValue({ lean });
    const find = jest.fn().mockReturnValue({ sort });
    const model = { find } as unknown as Model<SensorLocationDocument>;
    const repository = new SensorLocationRepository(model);

    await expect(repository.findSensorIdsByCity('Samara')).resolves.toEqual([
      'sensor-a',
      'sensor-b',
    ]);
    expect(find).toHaveBeenCalledWith(
      {
        geocoding_status: SensorLocationStatus.Resolved,
        city: 'Samara',
      },
      { _id: 0, sensor_id: 1 },
    );
    expect(sort).toHaveBeenCalledWith({ sensor_id: 1 });
  });
});
