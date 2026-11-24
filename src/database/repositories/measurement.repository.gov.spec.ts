import type { Model } from 'mongoose';
import type {
  Measurement,
  MeasurementDocument,
} from '../schemas/measurement.schema.js';
import { MeasurementRepository } from './measurement.repository.js';

const doc = (sensor_id: string, source_type?: string): Measurement => ({
  sensor_id,
  source_type,
  model: 2,
  measurement: { pm25: 1 },
  timestamp: 1795521600,
});

describe('MeasurementRepository.upsertMany and government station ids', () => {
  type Op = { updateOne: { update: { $set: Measurement } } };
  const bulkWrite = jest.fn<Promise<object>, [Op[]]>().mockResolvedValue({});
  const repo = new MeasurementRepository({
    bulkWrite,
  } as unknown as Model<MeasurementDocument>);

  beforeEach(() => bulkWrite.mockClear());

  it('writes a station id only from the gov-stations module', async () => {
    await repo.upsertMany([
      doc('de-uba-21', 'cps'),
      doc('de-uba-21', 'gov'),
      doc('4H1euDXpH5HRTXDXDqMv4w15nhyjsW1ZgGiqG51TZGzH36TF', 'cps'),
    ]);
    const ops = bulkWrite.mock.calls[0][0];
    expect(
      ops.map((o) => [
        o.updateOne.update.$set.sensor_id,
        o.updateOne.update.$set.source_type,
      ]),
    ).toEqual([
      ['de-uba-21', 'gov'],
      ['4H1euDXpH5HRTXDXDqMv4w15nhyjsW1ZgGiqG51TZGzH36TF', 'cps'],
    ]);
  });

  it('writes nothing when every document is refused', async () => {
    await repo.upsertMany([doc('nl-rivm-NL10742')]);
    expect(bulkWrite).not.toHaveBeenCalled();
  });
});
