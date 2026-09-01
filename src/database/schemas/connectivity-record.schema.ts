import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import {
  ConnectivityLegacyProjectionStatus,
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivityStructureStatus,
} from '../../common/constants/connectivity-storage.enum.js';

export type ConnectivityRecordDocument = HydratedDocument<ConnectivityRecord>;

/** Нормализованное публичное событие с сохранением позиции в сообщении. */
@Schema({ _id: false })
export class ConnectivityPublicEvent {
  @Prop({ required: true, type: String })
  sensor_type!: string;

  @Prop({ type: String })
  measurement_type?: string;

  @Prop({ type: Number })
  value?: number;

  @Prop({ type: String })
  unit?: string;

  @Prop({ type: Number })
  lat?: number;

  @Prop({ type: Number })
  lon?: number;

  @Prop({ type: Number })
  height_m?: number;
}

const ConnectivityPublicEventSchema = SchemaFactory.createForClass(
  ConnectivityPublicEvent,
);

/** Зашифрованная private-секция без попытки расшифровки. */
@Schema({ _id: false })
export class ConnectivityPrivateSection {
  @Prop({ required: true, type: Number })
  version!: number;

  @Prop({ required: true, type: String })
  algorithm!: string;

  @Prop({ required: true, type: Buffer })
  from!: Buffer;

  @Prop({ required: true, type: Buffer })
  nonce!: Buffer;

  @Prop({ required: true, type: Buffer })
  ciphertext!: Buffer;
}

const ConnectivityPrivateSectionSchema = SchemaFactory.createForClass(
  ConnectivityPrivateSection,
);

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

  @Prop({ required: true, type: String })
  source_id!: string;

  @Prop({ type: String })
  node_id?: string;

  @Prop({ type: Number })
  block?: number;

  @Prop({ type: String })
  cid?: string;

  @Prop({ required: true, type: String })
  protocol!: string;

  @Prop({ required: true, type: String })
  schema_package!: string;

  @Prop({ required: true, type: String })
  schema_revision!: string;

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

  @Prop({ required: true, type: [ConnectivityPublicEventSchema], default: [] })
  public_events!: ConnectivityPublicEvent[];

  @Prop({
    required: true,
    type: [ConnectivityPrivateSectionSchema],
    default: [],
  })
  private_sections!: ConnectivityPrivateSection[];

  @Prop({
    required: true,
    type: String,
    enum: ConnectivityLegacyProjectionStatus,
  })
  legacy_projection_status!: ConnectivityLegacyProjectionStatus;

  @Prop({ type: String })
  legacy_measurement_key?: string;

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
