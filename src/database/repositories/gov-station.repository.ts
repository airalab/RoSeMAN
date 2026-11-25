import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FEEDS_CONNECTION } from '../feeds-connection.js';
import { areaId } from '../../gov-stations/areas.js';
import type { GovStation } from '../../gov-stations/sources/types.js';
import {
  GovStationEntry,
  type GovStationDocument,
} from '../schemas/gov-station.schema.js';

export type StoredGovStation = GovStation & {
  source: string;
  area: string;
  last_ts?: number;
};

/** Side of a grid cell of FeedArea.cells, degrees. */
export const AREA_CELL_DEG = 0.1;

export interface FeedArea {
  area: string;
  source: string;
  stations: number;
  /** [west, south, east, north] of its stations */
  bbox: [number, number, number, number];
  /**
   * Grid cells with a station, [floor(lat / AREA_CELL_DEG), floor(lng / AREA_CELL_DEG)]: where the area
   * really is. A country's bbox reaches over its neighbours; the cells do not.
   */
  cells: Array<[number, number]>;
}

const HIDE = { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 };

@Injectable()
export class GovStationRepository {
  constructor(
    @InjectModel(GovStationEntry.name, FEEDS_CONNECTION)
    private readonly model: Model<GovStationDocument>,
  ) {}

  /** Writes a source's current station list; stations it no longer lists stay as they were. */
  async upsertMany(source: string, stations: GovStation[]): Promise<void> {
    if (!stations.length) return;
    await this.model.bulkWrite(
      stations.map((s) => ({
        updateOne: {
          filter: { id: s.id },
          update: { $set: { ...s, source, area: areaId(source, s.region) } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async findBySource(source: string): Promise<StoredGovStation[]> {
    return this.model.find({ source }, HIDE).lean<StoredGovStation[]>();
  }

  async findByIds(ids: string[]): Promise<StoredGovStation[]> {
    return this.model
      .find({ id: { $in: ids } }, HIDE)
      .lean<StoredGovStation[]>();
  }

  /** Moves each station's newest-hour mark forward (never back). */
  async touch(newest: Map<string, number>): Promise<void> {
    if (!newest.size) return;
    await this.model.bulkWrite(
      [...newest].map(([id, ts]) => ({
        updateOne: { filter: { id }, update: { $max: { last_ts: ts } } },
      })),
      { ordered: false },
    );
  }

  /** Areas with a station heard from since `since`: how many, and where. */
  async areas(since: number): Promise<FeedArea[]> {
    return this.model.aggregate<FeedArea>([
      { $match: { last_ts: { $gte: since } } },
      {
        $group: {
          _id: '$area',
          source: { $first: '$source' },
          stations: { $sum: 1 },
          w: { $min: '$lng' },
          s: { $min: '$lat' },
          e: { $max: '$lng' },
          n: { $max: '$lat' },
          // $concatArrays: a bare array here would be read as the accumulator's arguments
          cells: {
            $addToSet: {
              $concatArrays: [
                [
                  { $floor: { $divide: ['$lat', AREA_CELL_DEG] } },
                  { $floor: { $divide: ['$lng', AREA_CELL_DEG] } },
                ],
              ],
            },
          },
        },
      },
      {
        $project: {
          _id: 0,
          area: '$_id',
          source: 1,
          stations: 1,
          bbox: ['$w', '$s', '$e', '$n'],
          cells: 1,
        },
      },
      { $sort: { area: 1 } },
    ]);
  }

  async findByArea(area: string, since: number): Promise<StoredGovStation[]> {
    return this.model
      .find({ area, last_ts: { $gte: since } }, HIDE)
      .lean<StoredGovStation[]>();
  }

  async exists(id: string): Promise<boolean> {
    return (await this.model.exists({ id })) !== null;
  }
}
