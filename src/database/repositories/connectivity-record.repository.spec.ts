import type { Model } from 'mongoose';
import {
  ConnectivityLegacyProjectionStatus,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivitySourceType,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';
import type { ConnectivityRecordDocument } from '../schemas/connectivity-record.schema.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from './connectivity-record.repository.js';

describe('ConnectivityRecordRepository', () => {
  it('выполняет идемпотентный upsert строго по record_key', async () => {
    const exec = jest.fn().mockResolvedValue(undefined);
    const updateOne = jest.fn().mockReturnValue({ exec });
    const model = {
      updateOne,
    } as unknown as Model<ConnectivityRecordDocument>;
    const repository = new ConnectivityRecordRepository(model);
    const record: ConnectivityRecordInput = {
      record_key: 'cps:1:cid:0',
      payload_key: 'cps:1:cid',
      envelope_index: 0,
      source_type: ConnectivitySourceType.Cps,
      source_id: 'cps:1:cid',
      protocol: 'connectivity',
      schema_package: 'core.v1',
      schema_revision: 'revision',
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Pending,
      decode_status: ConnectivityRecordDecodeStatus.Pending,
      public_events: [],
      private_sections: [],
      legacy_projection_status: ConnectivityLegacyProjectionStatus.Pending,
    };

    await repository.upsertRecord(record);

    expect(updateOne).toHaveBeenCalledWith(
      { record_key: record.record_key },
      { $set: record },
      { upsert: true },
    );
    expect(exec).toHaveBeenCalled();
  });
});
