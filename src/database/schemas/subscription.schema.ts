import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** @deprecated Документ подписки устаревшего RWS-потока. */
export type SubscriptionDocument = HydratedDocument<Subscription>;

/**
 * Подписка устройства, полученная через RWS.
 * @deprecated CPS разрешает владельца через registry/scopes.
 */
@Schema({ collection: 'subscriptions', timestamps: true })
export class Subscription {
  @Prop({ required: true, type: String, index: true })
  account!: string;

  @Prop({ required: true, type: String, index: true })
  owner!: string;

  @Prop({ type: Number })
  block?: number;
}

/** @deprecated Схема подписок устаревшего RWS-потока. */
export const SubscriptionSchema = SchemaFactory.createForClass(Subscription);

SubscriptionSchema.index({ account: 1, owner: 1 }, { unique: true });
