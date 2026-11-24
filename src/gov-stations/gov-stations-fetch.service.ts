import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GovMeasurementRepository } from '../database/repositories/gov-measurement.repository.js';
import { selectSources } from './sources/index.js';
import type { GovSource } from './sources/types.js';

interface FetchConfig {
  sources: string[];
  pollInterval: number;
  timeoutMs: number;
}

/**
 * Polls every enabled source and stores its latest hour (GOV_STATIONS_ENABLED=true).
 * The sources publish hourly; polling every 15 min catches a new hour without a long lag,
 * and the unique (station, hour) index makes repeated reads of the same hour no-ops.
 */
@Injectable()
export class GovStationsFetchService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GovStationsFetchService.name);
  private readonly cfg: FetchConfig;
  private readonly sources: GovSource[];
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    config: ConfigService,
    private readonly readings: GovMeasurementRepository,
  ) {
    this.cfg = config.get<FetchConfig>('govStations') as FetchConfig;
    this.sources = selectSources(this.cfg.sources);
  }

  onModuleInit(): void {
    this.logger.log(
      `gov stations: ${this.sources.map((s) => s.id).join(', ') || 'no sources'}`,
    );
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
      await Promise.all(this.sources.map((s) => this.fetchOne(s)));
    } finally {
      this.running = false;
    }
  }

  private async fetchOne(source: GovSource): Promise<void> {
    try {
      const latest = await source.fetchLatest(this.cfg.timeoutMs);
      const added = await this.readings.upsertMany(
        latest.map((r) => ({ ...r, source: source.id })),
      );
      if (added) this.logger.log(`${source.id}: ${added} new station-hours`);
    } catch (e) {
      this.logger.warn(`${source.id}: ${(e as Error).message}`);
    }
  }
}
