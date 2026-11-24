import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SensorLatestDocument = HydratedDocument<SensorLatest>;

/**
 * The newest measurement of every sensor, one document per sensor: what the map's markers need
 * (position, owner, device model, CPS bundle, time). Kept in step by MeasurementRepository.upsertMany,
 * so the markers for "now" read ~1 document per sensor instead of a day of measurements.
 * Filled once from history by `npm run backfill-sensor-latest`.
 */
@Schema({ collection: 'sensor_latest', versionKey: false })
export class SensorLatest {
  @Prop({ required: true, type: String, unique: true })
  sensor_id!: string;

  @Prop({ required: true, type: Number })
  model!: number;

  @Prop({ type: { lat: Number, lng: Number }, _id: false })
  geo?: { lat: number; lng: number } | null;

  @Prop({ type: String })
  donated_by?: string | null;

  @Prop({ type: String })
  device_model?: string | null;

  @Prop({ type: String })
  owner?: string | null;

  @Prop({ type: [String], default: undefined })
  bundle?: string[] | null;

  @Prop({ required: true, type: Number, index: true })
  timestamp!: number;
}

export const SensorLatestSchema = SchemaFactory.createForClass(SensorLatest);
