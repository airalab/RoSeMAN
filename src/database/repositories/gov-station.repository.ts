import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { GovStation } from '../../gov-stations/sources/types.js';
import {
  GovStationEntry,
  type GovStationDocument,
} from '../schemas/gov-station.schema.js';

export type StoredGovStation = GovStation & { source: string };

@Injectable()
export class GovStationRepository {
  constructor(
    @InjectModel(GovStationEntry.name)
    private readonly model: Model<GovStationDocument>,
  ) {}

  /** Writes a source's current station list; stations it no longer lists stay as they were. */
  async upsertMany(source: string, stations: GovStation[]): Promise<void> {
    if (!stations.length) return;
    await this.model.bulkWrite(
      stations.map((s) => ({
        updateOne: {
          filter: { id: s.id },
          update: { $set: { ...s, source } },
          upsert: true,
        },
      })),
      { ordered: false },
    );
  }

  async findBySource(source: string): Promise<StoredGovStation[]> {
    return this.model
      .find({ source }, { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 })
      .lean<StoredGovStation[]>();
  }

  async findByIds(ids: string[]): Promise<StoredGovStation[]> {
    return this.model
      .find(
        { id: { $in: ids } },
        { _id: 0, __v: 0, createdAt: 0, updatedAt: 0 },
      )
      .lean<StoredGovStation[]>();
  }

  async exists(id: string): Promise<boolean> {
    return (await this.model.exists({ id })) !== null;
  }
}
