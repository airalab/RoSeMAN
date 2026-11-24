import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  GovMeasurement,
  type GovMeasurementDocument,
} from '../schemas/gov-measurement.schema.js';

export interface GovReading {
  source: string;
  station_id: string;
  timestamp: number;
  values: Record<string, number>;
}

@Injectable()
export class GovMeasurementRepository {
  constructor(
    @InjectModel(GovMeasurement.name)
    private readonly model: Model<GovMeasurementDocument>,
  ) {}

  /** Stores readings; an hour already stored for a station is updated in place. */
  async upsertMany(readings: GovReading[]): Promise<number> {
    if (!readings.length) return 0;
    const res = await this.model.bulkWrite(
      readings.map((r) => ({
        updateOne: {
          filter: { station_id: r.station_id, timestamp: r.timestamp },
          update: { $set: r },
          upsert: true,
        },
      })),
      { ordered: false },
    );
    return res.upsertedCount;
  }

  /** The newest reading of every station seen since `since` (epoch seconds). */
  async latest(since: number): Promise<GovReading[]> {
    return this.model.aggregate<GovReading>([
      { $match: { timestamp: { $gte: since } } },
      { $sort: { timestamp: -1 } },
      {
        $group: {
          _id: '$station_id',
          source: { $first: '$source' },
          station_id: { $first: '$station_id' },
          timestamp: { $first: '$timestamp' },
          values: { $first: '$values' },
        },
      },
      { $project: { _id: 0 } },
    ]);
  }

  async history(
    stationId: string,
    from: number,
    to: number,
  ): Promise<GovReading[]> {
    return this.model
      .find(
        { station_id: stationId, timestamp: { $gte: from, $lte: to } },
        { _id: 0, source: 1, station_id: 1, timestamp: 1, values: 1 },
      )
      .sort({ timestamp: 1 })
      .lean<GovReading[]>();
  }
}
