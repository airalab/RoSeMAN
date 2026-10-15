import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { SensorLocationStatus } from '../../common/constants/sensor-location-status.enum.js';

export type SensorLocationDocument = HydratedDocument<SensorLocation>;

/** Каноническая актуальная географическая проекция CPS-сенсора. */
@Schema({ collection: 'sensor_locations', timestamps: true })
export class SensorLocation {
  @Prop({ required: true, type: String })
  sensor_id!: string;

  @Prop({ required: true, type: { lat: Number, lng: Number } })
  geo!: { lat: number; lng: number };

  @Prop({ type: String, default: null })
  city!: string | null;

  @Prop({ type: String, default: null })
  region!: string | null;

  @Prop({ type: String, default: null })
  country!: string | null;

  @Prop({ required: true, type: String, enum: SensorLocationStatus })
  geocoding_status!: SensorLocationStatus;

  @Prop({ required: true, type: String })
  source_record_key!: string;

  @Prop({ required: true, type: Types.ObjectId })
  source_record_id!: Types.ObjectId;

  @Prop({ required: true, type: Date })
  source_recorded_at!: Date;
}

export const SensorLocationSchema =
  SchemaFactory.createForClass(SensorLocation);

SensorLocationSchema.index({ sensor_id: 1 }, { unique: true });
SensorLocationSchema.index({ geocoding_status: 1, updatedAt: 1 });
SensorLocationSchema.index({ geocoding_status: 1, city: 1, sensor_id: 1 });
