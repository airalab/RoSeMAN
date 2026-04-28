import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type SubscriptionDocument = HydratedDocument<Subscription>;

@Schema({ collection: 'subscriptions', timestamps: true })
export class Subscription {
  @Prop({ required: true, type: String, index: true })
  account!: string;

  @Prop({ required: true, type: String, index: true })
  owner!: string;

  @Prop({ type: Number })
  block?: number;
}

export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ account: 1, owner: 1 }, { unique: true });
