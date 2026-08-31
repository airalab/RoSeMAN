import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeasurementDocument = HydratedDocument<Measurement>;

@Schema({ collection: 'measurements', timestamps: true })
export class Measurement {
  @Prop({ type: Types.ObjectId, ref: 'Datalog', index: true })
  datalog_id?: Types.ObjectId;

  @Prop({ type: String })
  source_type?: string;

  @Prop({ type: String })
  source_id?: string;

  @Prop({ required: true, type: String, index: true })
  sensor_id!: string;

  @Prop({ required: true, type: Number })
  model!: number;

  @Prop({ required: true, type: Object })
  measurement!: Record<string, unknown>;

  @Prop({ type: { lat: Number, lng: Number } })
  geo?: { lat: number; lng: number };

  @Prop({ type: String })
  donated_by?: string;

  @Prop({ type: String })
  device_model?: string;

  @Prop({ type: String })
  owner?: string;

  @Prop({ required: true, type: Number, index: true })
  timestamp!: number;
}

export const MeasurementSchema = SchemaFactory.createForClass(Measurement);

MeasurementSchema.index({ sensor_id: 1, timestamp: 1 }, { unique: true });
MeasurementSchema.index({ source_type: 1, source_id: 1 });

// Индекс для выборки сенсоров по владельцу (GET /api/v2/sensor/owner/:owner).
// Составной owner + sensor_id делает distinct по sensor_id covered-запросом.
MeasurementSchema.index({ owner: 1, sensor_id: 1 });
