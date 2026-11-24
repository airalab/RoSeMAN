import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovSourceStateDocument = HydratedDocument<GovSourceState>;

/**
 * Whether a government source (src/gov-stations/sources) is shown: a source without a document here is on.
 * Switched at run time by `node dist/scripts/gov-source.js on|off <id>`; an "off" source is not polled and
 * its stations leave the map within a minute, with no restart. GOV_STATIONS_SOURCES still decides which
 * sources a deployment runs at all.
 */
@Schema({ collection: 'gov_sources', versionKey: false })
export class GovSourceState {
  @Prop({ required: true, type: String, unique: true })
  id!: string;

  @Prop({ required: true, type: Boolean })
  enabled!: boolean;

  @Prop({ required: true, type: Date })
  changed_at!: Date;
}

export const GovSourceStateSchema =
  SchemaFactory.createForClass(GovSourceState);
