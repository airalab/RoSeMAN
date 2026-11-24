import type { Model } from 'mongoose';
import type { SensorDocument } from '../schemas/sensor.schema.js';
import { SensorRepository } from './sensor.repository.js';

describe('SensorRepository.bulkUpsert and government station ids', () => {
  type Op = { updateOne: { filter: { sensor_id: string } } };
  const bulkWrite = jest.fn<Promise<object>, [Op[]]>().mockResolvedValue({});
  const repo = new SensorRepository({
    bulkWrite,
  } as unknown as Model<SensorDocument>);

  beforeEach(() => bulkWrite.mockClear());

  it('does not register a sensor under a government station id', async () => {
    await repo.bulkUpsert([
      ['de-uba-21', { lat: 52.5, lng: 13.3 }],
      [
        '4H1euDXpH5HRTXDXDqMv4w15nhyjsW1ZgGiqG51TZGzH36TF',
        { lat: 34.8, lng: 32.5 },
      ],
    ]);
    expect(
      bulkWrite.mock.calls[0][0].map((o) => o.updateOne.filter.sensor_id),
    ).toEqual(['4H1euDXpH5HRTXDXDqMv4w15nhyjsW1ZgGiqG51TZGzH36TF']);
  });

  it('writes nothing when every entry is refused', async () => {
    await repo.bulkUpsert([['nl-rivm-NL10742', { lat: 52, lng: 4.8 }]]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
