import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type {
  ConnectivityLegacyProjectionStatus,
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';
import {
  ConnectivityRecord,
  type ConnectivityRecordDocument,
  type ConnectivityPrivateSection,
  type ConnectivityPublicEvent,
} from '../schemas/connectivity-record.schema.js';

export interface ConnectivityRecordInput {
  readonly record_key: string;
  readonly payload_key: string;
  readonly envelope_index: number;
  readonly source_type: string;
  readonly source_id: string;
  readonly node_id?: string;
  readonly block?: number;
  readonly cid?: string;
  readonly protocol: string;
  readonly schema_package: string;
  readonly schema_revision: string;
  readonly sensor_id?: string;
  readonly sensor_id_raw?: Buffer;
  readonly timestamp_ms?: string;
  readonly recorded_at?: Date;
  readonly nonce?: Buffer;
  readonly message_raw?: Buffer;
  readonly signature?: Buffer;
  readonly structure_status: ConnectivityStructureStatus;
  readonly signature_status: ConnectivitySignatureStatus;
  readonly decode_status: ConnectivityRecordDecodeStatus;
  readonly error_code?: string;
  readonly owner_raw?: Buffer;
  readonly owner?: string;
  readonly payload_type?: ConnectivityPayloadType;
  readonly public_events: ConnectivityPublicEvent[];
  readonly private_sections: ConnectivityPrivateSection[];
  readonly legacy_projection_status: ConnectivityLegacyProjectionStatus;
  readonly legacy_measurement_key?: string;
  readonly projection_error_code?: string;
}

/** Репозиторий occurrence-записей Connectivity Protocol. */
@Injectable()
export class ConnectivityRecordRepository {
  /**
   * Создаёт репозиторий поверх Mongoose-модели protocol records.
   * @param model - модель коллекции connectivity_records
   */
  constructor(
    @InjectModel(ConnectivityRecord.name)
    private readonly model: Model<ConnectivityRecordDocument>,
  ) {}

  /**
   * Идемпотентно создаёт или обновляет occurrence по record_key.
   * @param record - полное текущее представление protocol record
   */
  async upsertRecord(record: ConnectivityRecordInput): Promise<void> {
    await this.model
      .updateOne(
        { record_key: record.record_key },
        { $set: record },
        { upsert: true },
      )
      .exec();
  }
}
