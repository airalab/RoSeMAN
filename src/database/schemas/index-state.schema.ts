import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type IndexStateDocument = HydratedDocument<IndexState>;

@Schema({ collection: 'index_state' })
export class IndexState {
  @Prop({ required: true, type: String, unique: true })
  key!: string;

  @Prop({ required: true, type: Number })
  value!: number;
}

export const IndexStateSchema = SchemaFactory.createForClass(IndexState);
