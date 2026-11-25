import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovStationDocument = HydratedDocument<GovStationEntry>;

/**
 * A station of a national air-quality network as its source last listed it (src/gov-stations).
 * Refreshed about once a day by the fetcher; the read API names and places stations from here.
 * Lives in the feeds database (FEEDS_CONNECTION), apart from the data of our own devices.
 */
@Schema({ collection: 'feed_stations', timestamps: true })
export class GovStationEntry {
  /** "<source>-<the network's station code>", the sensor_id of the station on the map */
  @Prop({ required: true, type: String, unique: true })
  id!: string;

  @Prop({ required: true, type: String, index: true })
  source!: string;

  @Prop({ required: true, type: String })
  name!: string;

  @Prop({ required: true, type: String })
  kind!: string;

  @Prop({ required: true, type: Number })
  lat!: number;

  @Prop({ required: true, type: Number })
  lng!: number;

  @Prop({ type: Boolean })
  approx?: boolean;

  @Prop({ type: String })
  operator?: string;

  /** Map visitor's unit of choice: "<source>" for a national network, "<source>:<ISO 3166 code>" else (areas.ts). */
  @Prop({ required: true, type: String, index: true })
  area!: string;

  /** End of the station's newest stored hour, epoch seconds; stations silent for a day leave the map. */
  @Prop({ type: Number, index: true })
  last_ts?: number;
}

export const GovStationSchema = SchemaFactory.createForClass(GovStationEntry);
