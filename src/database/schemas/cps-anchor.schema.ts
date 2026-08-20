import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { CpsAnchorStatus } from '../../common/constants/cps-anchor-status.enum.js';

export type CpsAnchorDocument = HydratedDocument<CpsAnchor>;

/**
 * Идемпотентный элемент очереди обработки payload CPS-узла.
 */
@Schema({ collection: 'cps_anchors', timestamps: true })
export class CpsAnchor {
  @Prop({ required: true, type: String })
  source_key!: string;

  @Prop({ required: true, type: String })
  node_id!: string;

  @Prop({ required: true, type: Number })
  block!: number;

  @Prop({ required: true, type: String })
  cid!: string;

  @Prop({ type: String })
  owner?: string;

  @Prop({ required: true, type: Number, enum: CpsAnchorStatus })
  status!: CpsAnchorStatus;

  @Prop({ required: true, type: Number, default: 0 })
  attempt_count!: number;

  @Prop({ required: true, type: Number, default: 0 })
  valid_envelope_count!: number;

  @Prop({ required: true, type: Number, default: 0 })
  invalid_envelope_count!: number;

  @Prop({ type: Date })
  available_at?: Date;

  @Prop({ type: Date })
  lease_expires_at?: Date;

  @Prop({ type: String })
  error_code?: string;

  @Prop({ type: String })
  error_message?: string;
}

export const CpsAnchorSchema = SchemaFactory.createForClass(CpsAnchor);

CpsAnchorSchema.index({ source_key: 1 }, { unique: true });
CpsAnchorSchema.index({ status: 1, available_at: 1, block: 1 });
CpsAnchorSchema.index({ node_id: 1, block: -1 });
