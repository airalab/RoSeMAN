import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';

export type ConnectivityRecordDocument = HydratedDocument<ConnectivityRecord>;
export type ConnectivityMessageJson = Record<string, unknown>;

/** Каноническая запись одного occurrence envelope в конкретном payload. */
@Schema({ collection: 'connectivity_records', timestamps: true })
export class ConnectivityRecord {
  @Prop({ required: true, type: String })
  record_key!: string;

  @Prop({ required: true, type: String })
  payload_key!: string;

  @Prop({ required: true, type: Number })
  envelope_index!: number;

  @Prop({ required: true, type: String })
  source_type!: string;

  @Prop({ type: String })
  node_id?: string;

  @Prop({ type: Number })
  block?: number;

  @Prop({ type: String })
  cid?: string;

  @Prop({ type: String })
  sensor_id?: string;

  @Prop({ type: Buffer })
  sensor_id_raw?: Buffer;

  @Prop({ type: SchemaTypes.Decimal128 })
  timestamp_ms?: Types.Decimal128;

  @Prop({ type: Date })
  recorded_at?: Date;

  @Prop({ type: Buffer })
  nonce?: Buffer;

  @Prop({ type: Buffer })
  message_raw?: Buffer;

  @Prop({ type: SchemaTypes.Mixed })
  message_json?: ConnectivityMessageJson;

  @Prop({ type: Buffer })
  signature?: Buffer;

  @Prop({
    required: true,
    type: String,
    enum: ConnectivityStructureStatus,
  })
  structure_status!: ConnectivityStructureStatus;

  @Prop({
    required: true,
    type: String,
    enum: ConnectivitySignatureStatus,
  })
  signature_status!: ConnectivitySignatureStatus;

  @Prop({
    required: true,
    type: String,
    enum: ConnectivityRecordDecodeStatus,
  })
  decode_status!: ConnectivityRecordDecodeStatus;

  @Prop({ type: String })
  error_code?: string;

  @Prop({ type: Buffer })
  owner_raw?: Buffer;

  @Prop({ type: String })
  owner?: string;

  @Prop({ type: String, enum: ConnectivityPayloadType })
  payload_type?: ConnectivityPayloadType;

  @Prop({ required: true, type: [String], default: [] })
  measurement_types!: string[];

  @Prop({ type: String })
  projection_error_code?: string;
}

export const ConnectivityRecordSchema =
  SchemaFactory.createForClass(ConnectivityRecord);

ConnectivityRecordSchema.index({ record_key: 1 }, { unique: true });
ConnectivityRecordSchema.index(
  { payload_key: 1, envelope_index: 1 },
  { unique: true },
);
ConnectivityRecordSchema.index({ sensor_id: 1, recorded_at: 1 });
ConnectivityRecordSchema.index({ owner: 1, recorded_at: 1 });
ConnectivityRecordSchema.index({ payload_type: 1, recorded_at: 1 });
ConnectivityRecordSchema.index({ recorded_at: -1, _id: -1 });
