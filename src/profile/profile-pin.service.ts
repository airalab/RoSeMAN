import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorProfileRepository } from '../database/repositories/sensor-profile.repository.js';
import type { SensorProfileDocument } from '../database/schemas/sensor-profile.schema.js';
import { KuboClient } from './kubo-client.js';
import { parseProfileDocument, ProfileFormatError } from './profile-format.js';

interface PinConfig {
  pollInterval: number;
  batchSize: number;
  pinTimeoutMs: number;
  maxAttempts: number;
  retryBaseMs: number;
  maxProfileBytes: number;
  maxImageBytes: number;
  maxImages: number;
  maxDescriptionChars: number;
}

/**
 * Pulls pending profiles: profile.json → validate → each image (size check, pin) → pin
 * profile.json → ready. Invalid content fails at once; missing blocks are retried with
 * exponential backoff, since the phone may come back online and serve them.
 */
@Injectable()
export class ProfilePinService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProfilePinService.name);
  private readonly cfg: PinConfig;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly profiles: SensorProfileRepository,
    private readonly kubo: KuboClient,
  ) {
    this.cfg = config.get<PinConfig>('profile') as PinConfig;
  }

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), this.cfg.pollInterval);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const due = await this.profiles.findDue(this.cfg.batchSize);
      // Different sensors are independent; let their phones hand over blocks in parallel.
      await Promise.all(due.map((p) => this.processOne(p)));
    } catch (e) {
      this.logger.error(`profile pin tick failed: ${(e as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async processOne(
    p: Pick<SensorProfileDocument, 'sensor_id' | 'cid' | 'block' | 'attempts'>,
  ): Promise<void> {
    const { sensor_id: sensor, cid, block } = p;
    try {
      const bytes = await this.kubo.cat(
        cid,
        this.cfg.maxProfileBytes,
        this.cfg.pinTimeoutMs,
      );
      const doc = parseProfileDocument(bytes, sensor, {
        maxDescriptionChars: this.cfg.maxDescriptionChars,
        maxImages: this.cfg.maxImages,
      });
      for (const image of doc.images) {
        const size = await this.kubo.dagSize(image, this.cfg.pinTimeoutMs);
        if (size > this.cfg.maxImageBytes) {
          throw new ProfileFormatError(
            `image ${image} is ${size} bytes, limit ${this.cfg.maxImageBytes}`,
          );
        }
        await this.kubo.pin(image, this.cfg.pinTimeoutMs);
      }
      await this.kubo.pin(cid, this.cfg.pinTimeoutMs);
      await this.profiles.markReady(
        sensor,
        cid,
        block,
        doc.description,
        doc.images,
      );
      this.logger.log(
        `profile ${cid} for ${sensor} ready: ${doc.images.length} image(s)`,
      );
    } catch (e) {
      const message = (e as Error).message;
      const attempts = (p.attempts ?? 0) + 1;
      if (e instanceof ProfileFormatError || attempts >= this.cfg.maxAttempts) {
        await this.profiles.markFailed(sensor, cid, message);
        this.logger.warn(`profile ${cid} for ${sensor} failed: ${message}`);
        return;
      }
      const delay = this.cfg.retryBaseMs * 2 ** (attempts - 1);
      await this.profiles.markRetry(
        sensor,
        cid,
        attempts,
        new Date(Date.now() + delay),
        message,
      );
      this.logger.debug(
        `profile ${cid} for ${sensor} retry ${attempts} in ${delay} ms: ${message}`,
      );
    }
  }
}
