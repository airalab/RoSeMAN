import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SensorProfile,
  SensorProfileStatus,
  type SensorProfileDocument,
} from '../schemas/sensor-profile.schema.js';

export interface SensorProfileAnchor {
  sensor_id: string;
  owner: string;
  node_id: string;
  block: number;
  cid: string;
}

@Injectable()
export class SensorProfileRepository {
  constructor(
    @InjectModel(SensorProfile.name)
    private readonly model: Model<SensorProfileDocument>,
  ) {}

  /** Queues a profile CID unless a newer (or the same) block is already recorded. */
  async upsertPending(anchor: SensorProfileAnchor): Promise<boolean> {
    const res = await this.model.updateOne(
      {
        sensor_id: anchor.sensor_id,
        $or: [{ block: { $lt: anchor.block } }, { block: { $exists: false } }],
      },
      {
        $set: {
          ...anchor,
          status: SensorProfileStatus.Pending,
          attempts: 0,
          next_attempt_at: new Date(0),
          error: null,
        },
      },
    );
    if (res.matchedCount > 0) return true;
    // No document yet: insert. A concurrent newer insert wins through the unique index.
    try {
      await this.model.create({
        ...anchor,
        status: SensorProfileStatus.Pending,
        attempts: 0,
        next_attempt_at: new Date(0),
      });
      return true;
    } catch (e) {
      if ((e as { code?: number }).code === 11000) return false;
      throw e;
    }
  }

  async findDue(
    limit: number,
    now = new Date(),
  ): Promise<SensorProfileDocument[]> {
    return this.model
      .find({
        status: SensorProfileStatus.Pending,
        next_attempt_at: { $lte: now },
      })
      .sort({ next_attempt_at: 1 })
      .limit(limit)
      .exec();
  }

  /** Marks the pinned version ready — only if no newer CID arrived meanwhile. */
  async markReady(
    sensorId: string,
    cid: string,
    block: number,
    description: string,
    images: string[],
  ): Promise<void> {
    await this.model.updateOne(
      { sensor_id: sensorId, cid },
      {
        $set: {
          status: SensorProfileStatus.Ready,
          error: null,
          ready_cid: cid,
          ready_block: block,
          description,
          images,
        },
      },
    );
  }

  async markRetry(
    sensorId: string,
    cid: string,
    attempts: number,
    nextAt: Date,
    error: string,
  ): Promise<void> {
    await this.model.updateOne(
      { sensor_id: sensorId, cid },
      {
        $set: { attempts, next_attempt_at: nextAt, error: error.slice(0, 500) },
      },
    );
  }

  async markFailed(
    sensorId: string,
    cid: string,
    error: string,
  ): Promise<void> {
    await this.model.updateOne(
      { sensor_id: sensorId, cid },
      {
        $set: {
          status: SensorProfileStatus.Failed,
          error: error.slice(0, 500),
        },
      },
    );
  }

  async findBySensor(sensorId: string): Promise<SensorProfileDocument | null> {
    return this.model.findOne({ sensor_id: sensorId }).lean().exec();
  }

  /** True when the CID is an image of a profile that is currently shown. */
  async isShownImage(cid: string): Promise<boolean> {
    return (
      (await this.model.exists({ images: cid, ready_cid: { $ne: null } })) !==
      null
    );
  }
}
