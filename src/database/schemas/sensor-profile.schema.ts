import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SensorProfileDocument = HydratedDocument<SensorProfile>;

export enum SensorProfileStatus {
  /** CID seen on chain, blocks not pinned yet (the phone may still be uploading). */
  Pending = 'pending',
  /** profile.json and every image are pinned on our Kubo; safe to show. */
  Ready = 'ready',
  /** Gave up: invalid profile.json, oversized, or blocks never arrived. */
  Failed = 'failed',
}

/**
 * One document per sensor: the latest profile its owner set through a CPS node.
 * A newer block replaces an older one; the previously shown version stays until the
 * new one is pinned (`ready_*` fields), so a failed upload never blanks a profile.
 */
@Schema({ collection: 'sensor_profiles', timestamps: true })
export class SensorProfile {
  @Prop({ required: true, type: String, unique: true })
  sensor_id!: string;

  @Prop({ required: true, type: String, index: true })
  owner!: string;

  @Prop({ required: true, type: String })
  node_id!: string;

  /** Block of the latest cps.PayloadSet for this sensor. */
  @Prop({ required: true, type: Number })
  block!: number;

  /** CID of the latest profile.json (may still be pending). */
  @Prop({ required: true, type: String })
  cid!: string;

  @Prop({
    required: true,
    type: String,
    enum: Object.values(SensorProfileStatus),
    index: true,
  })
  status!: SensorProfileStatus;

  @Prop({ type: Number, default: 0 })
  attempts!: number;

  @Prop({ type: Date, default: () => new Date(0), index: true })
  next_attempt_at!: Date;

  @Prop({ type: String, default: null })
  error!: string | null;

  /** Last successfully pinned version — what the API shows. */
  @Prop({ type: String, default: null })
  ready_cid!: string | null;

  @Prop({ type: Number, default: null })
  ready_block!: number | null;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: [String], default: [] })
  images!: string[];
}

export const SensorProfileSchema = SchemaFactory.createForClass(SensorProfile);
