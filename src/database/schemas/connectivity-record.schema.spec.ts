import { model, Types } from 'mongoose';
import {
  ConnectivityLegacyProjectionStatus,
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
  });

  it('объявляет начальные индексы time-range фильтров', () => {
    expect(ConnectivityRecordSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ sensor_id: 1, recorded_at: 1 }, { background: true }],
        [{ owner: 1, recorded_at: 1 }, { background: true }],
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
      source_id: 'cps:1:cid',
      protocol: 'connectivity',
      schema_package: 'core.v1',
      schema_revision: 'revision',
      timestamp_ms: '18446744073709551615',
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Valid,
      decode_status: ConnectivityRecordDecodeStatus.Decoded,
      public_events: [],
      private_sections: [],
      legacy_projection_status: ConnectivityLegacyProjectionStatus.Skipped,
    });

    expect(document.validateSync()).toBeUndefined();
    expect(document.timestamp_ms).toBeInstanceOf(Types.Decimal128);
    expect(document.timestamp_ms?.toString()).toBe('18446744073709551615');
  });
});
