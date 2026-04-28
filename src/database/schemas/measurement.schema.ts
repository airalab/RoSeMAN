import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type MeasurementDocument = HydratedDocument<Measurement>;

@Schema({ collection: 'measurements', timestamps: true })
export class Measurement {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Datalog', index: true })
  datalog_id!: Types.ObjectId;

  @Prop({ required: true, type: String, index: true })
  sensor_id!: string;

  @Prop({ required: true, type: Number })
  model!: number;

  @Prop({ required: true, type: Object })
  measurement!: Record<string, unknown>;

  @Prop({ required: true, type: { lat: Number, lng: Number } })
  geo!: { lat: number; lng: number };

  @Prop({ type: String })
  donated_by?: string;

  @Prop({ required: true, type: Number, index: true })
  timestamp!: number;
}

export const MeasurementSchema = SchemaFactory.createForClass(Measurement);

MeasurementSchema.index({ sensor_id: 1, timestamp: 1 }, { unique: true });
