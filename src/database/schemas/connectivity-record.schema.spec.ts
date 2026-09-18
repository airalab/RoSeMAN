import { model, Types } from 'mongoose';
import {
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';
import { ConnectivityRecordSchema } from './connectivity-record.schema.js';

describe('ConnectivityRecordSchema', () => {
  it('обеспечивает уникальность occurrence двумя индексами', () => {
    expect(ConnectivityRecordSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ record_key: 1 }, { unique: true, background: true }],
        [
          { payload_key: 1, envelope_index: 1 },
          { unique: true, background: true },
        ],
      ]),
    );
    expect(ConnectivityRecordSchema.indexes()).toContainEqual([
      { recorded_at: -1, _id: -1 },
      { background: true },
    ]);
  });

  it('объявляет начальные индексы time-range фильтров', () => {
    expect(ConnectivityRecordSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ sensor_id: 1, recorded_at: 1 }, { background: true }],
        [{ node_id: 1, recorded_at: 1 }, { background: true }],
        [{ payload_type: 1, recorded_at: 1 }, { background: true }],
      ]),
    );
  });

  it('кастует полный uint64 timestamp в Decimal128 без потери точности', () => {
    const RecordModel = model(
      'ConnectivityRecordSchemaValidation',
      ConnectivityRecordSchema,
    );
    const document = new RecordModel({
      record_key: 'cps:1:cid:0',
      payload_key: 'cps:1:cid',
      envelope_index: 0,
      source_type: 'cps',
      timestamp_ms: '18446744073709551615',
      message_json: {
        metadata: { nodeId: '1', timestamp: '18446744073709551615' },
        urban: {
          public: [{ bme280: { temperature: { centiCelsius: 2250 } } }],
        },
      },
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Valid,
      decode_status: ConnectivityRecordDecodeStatus.Decoded,
      measurement_types: ['temperature'],
    });

    expect(document.validateSync()).toBeUndefined();
    expect(document.timestamp_ms).toBeInstanceOf(Types.Decimal128);
    expect(document.timestamp_ms?.toString()).toBe('18446744073709551615');
    expect(document.message_json).toEqual({
      metadata: { nodeId: '1', timestamp: '18446744073709551615' },
      urban: {
        public: [{ bme280: { temperature: { centiCelsius: 2250 } } }],
      },
    });
  });
});
