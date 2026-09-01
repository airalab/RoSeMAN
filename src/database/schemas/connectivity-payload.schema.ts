import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import {
  ConnectivityPayloadDecodeStatus,
  ProtocolBatchWireFormat,
} from '../../common/constants/connectivity-storage.enum.js';

export type ConnectivityPayloadDocument = HydratedDocument<ConnectivityPayload>;

/** Lossless-архив payload, фактически полученного от transport-источника. */
@Schema({ collection: 'connectivity_payloads', timestamps: true })
export class ConnectivityPayload {
  @Prop({ required: true, type: String })
  payload_key!: string;

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

  @Prop({ required: true, type: String, enum: ProtocolBatchWireFormat })
  wire_format!: ProtocolBatchWireFormat;

  @Prop({ required: true, type: Buffer })
  raw_payload!: Buffer;

  @Prop({ required: true, type: Number })
  raw_size!: number;

  @Prop({ required: true, type: String })
  raw_sha256!: string;

  @Prop({ required: true, type: String })
  schema_package!: string;

  @Prop({ required: true, type: String })
  schema_revision!: string;

  @Prop({
    required: true,
    type: String,
    enum: ConnectivityPayloadDecodeStatus,
  })
  decode_status!: ConnectivityPayloadDecodeStatus;

  @Prop({ type: String })
  error_code?: string;

  @Prop({ type: String })
  error_message?: string;

  @Prop({ required: true, type: Date })
  fetched_at!: Date;

  @Prop({ type: Date })
  decoded_at?: Date;
}

export const ConnectivityPayloadSchema =
  SchemaFactory.createForClass(ConnectivityPayload);

ConnectivityPayloadSchema.index({ payload_key: 1 }, { unique: true });
ConnectivityPayloadSchema.index({ cid: 1 });
ConnectivityPayloadSchema.index(
  { source_type: 1, source_id: 1 },
  { unique: true },
);
ConnectivityPayloadSchema.index({ decode_status: 1, fetched_at: 1 });
