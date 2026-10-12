import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** @deprecated Документ совместимой legacy-проекции cities. */
export type SensorDocument = HydratedDocument<Sensor>;

/**
 * Геокодированная проекция сенсора для старого Sensor API.
 * @deprecated Используйте данные Connectivity Protocol V3.
 */
@Schema({ collection: 'cities', timestamps: true })
export class Sensor {
  @Prop({ required: true, type: String, unique: true, index: true })
  sensor_id!: string;

  @Prop({ required: true, type: { lat: Number, lng: Number } })
  geo!: { lat: number; lng: number };

  @Prop({ type: String, default: null })
  city!: string | null;

  @Prop({ type: String, default: null })
  state!: string | null;

  @Prop({ type: String, default: null })
  country!: string | null;
}

/** @deprecated Схема совместимой legacy-проекции cities. */
export const SensorSchema = SchemaFactory.createForClass(Sensor);
