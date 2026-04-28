import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type StoryDocument = HydratedDocument<Story>;

/**
 * Схема коллекции `story`.
 * Хранит пользовательские истории/сообщения, опубликованные через rws-подписку.
 */
@Schema({ collection: 'stories', timestamps: true })
export class Story {
  @Prop({ type: Number })
  block?: number;

  @Prop({ required: true, type: String, index: true })
  author!: string;

  @Prop({ required: true, type: String, index: true })
  sensor_id!: string;

  @Prop({ required: true, type: String })
  message!: string;

  @Prop({ type: String, default: '' })
  icon!: string;

  @Prop({ required: true, type: Number, index: true })
  timestamp!: number;

  @Prop({ type: Number })
  timechain?: number;

  @Prop({ type: String, default: null })
  date!: string | null;
}

export const StorySchema = SchemaFactory.createForClass(Story);

StorySchema.index({ sensor_id: 1, timestamp: 1 }, { unique: true });
