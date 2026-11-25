import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovMeasurementDocument = HydratedDocument<GovMeasurement>;

/**
 * One hourly reading of one government station, as published by its network
 * (src/gov-stations/sources). Values are kept as published: μg/m³, hourly means.
 * Unique per station and hour, so polling more often than the source updates is harmless.
 * Lives in the feeds database (FEEDS_CONNECTION), apart from the data of our own devices.
 */
@Schema({ collection: 'feed_readings', timestamps: true })
export class GovMeasurement {
  /** Source id, e.g. "cy-dli". */
  @Prop({ required: true, type: String, index: true })
  source!: string;

  /** Station id, unique across sources, e.g. "cy-dli-nictra". */
  @Prop({ required: true, type: String })
  station_id!: string;

  /** Start of the published hour, epoch seconds. */
  @Prop({ required: true, type: Number })
  timestamp!: number;

  /** pm25, pm10, no2, o3, so2, co, … → μg/m³ */
  @Prop({ required: true, type: Object })
  values!: Record<string, number>;
}

export const GovMeasurementSchema =
  SchemaFactory.createForClass(GovMeasurement);
GovMeasurementSchema.index({ station_id: 1, timestamp: 1 }, { unique: true });
GovMeasurementSchema.index({ timestamp: -1 });
