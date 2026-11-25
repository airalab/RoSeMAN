import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { FEEDS_CONNECTION } from '../feeds-connection.js';
import {
  GovSourceState,
  type GovSourceStateDocument,
} from '../schemas/gov-source.schema.js';

/** How long the API trusts its copy of the switches: the delay of an on/off reaching the map. */
const CACHE_MS = 30_000;

@Injectable()
export class GovSourceRepository {
  private cache: { at: number; ids: Promise<Set<string>> } | null = null;

  constructor(
    @InjectModel(GovSourceState.name, FEEDS_CONNECTION)
    private readonly model: Model<GovSourceStateDocument>,
  ) {}

  /** Ids of the sources switched off; read at most every 30 s. */
  disabled(): Promise<Set<string>> {
    if (!this.cache || Date.now() - this.cache.at > CACHE_MS) {
      const ids = this.model
        .find({ enabled: false }, { id: 1 })
        .lean<Array<{ id: string }>>()
        .then((rows) => new Set(rows.map((r) => r.id)));
      // a failed read is retried on the next call, not cached
      ids.catch(() => (this.cache = null));
      this.cache = { at: Date.now(), ids };
    }
    return this.cache.ids;
  }

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await this.model.updateOne(
      { id },
      { $set: { enabled, changed_at: new Date() } },
      { upsert: true },
    );
    this.cache = null;
  }

  async list(): Promise<
    Array<{ id: string; enabled: boolean; changed_at: Date }>
  > {
    return this.model.find({}, { _id: 0 }).lean();
  }
}
