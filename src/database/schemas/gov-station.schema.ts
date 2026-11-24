import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type GovStationDocument = HydratedDocument<GovStationEntry>;

/**
 * A station of a national air-quality network as its source last listed it (src/gov-stations).
 * Refreshed about once a day by the fetcher; the read API names and places stations from here.
 */
@Schema({ collection: 'gov_stations', timestamps: true })
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
}

export const GovStationSchema = SchemaFactory.createForClass(GovStationEntry);
