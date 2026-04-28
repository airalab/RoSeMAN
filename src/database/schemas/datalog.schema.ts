import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { DatalogStatus } from '../../common/constants/datalog-status.enum.js';

export type DatalogDocument = HydratedDocument<Datalog>;

@Schema({ collection: 'datalogs', timestamps: true })
export class Datalog {
  @Prop({ required: true, type: Number, index: true })
  block!: number;

  @Prop({ required: true, type: String, index: true })
  sender!: string;

  @Prop({ required: true, type: String })
  resultHash!: string;

  @Prop({ required: true, type: Number, enum: DatalogStatus, index: true })
  status!: DatalogStatus;

  @Prop({ type: Number })
  timechain?: number;

  @Prop({ type: String })
  errorMessage?: string;
}

export const DatalogSchema = SchemaFactory.createForClass(Datalog);

DatalogSchema.index({ block: 1, sender: 1, resultHash: 1 }, { unique: true });
