import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GovMeasurementRepository } from '../database/repositories/gov-measurement.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { toSensorMeasurement } from './projection.js';
import { selectSources } from './sources/index.js';
import type { GovSource } from './sources/types.js';

interface FetchConfig {
  sources: string[];
  pollInterval: number;
  timeoutMs: number;
}

/**
 * Polls every enabled source and stores its latest hour (GOV_STATIONS_ENABLED=true): as published in
 * gov_measurements, and as a regular sensor in measurements (projection.ts) for the map.
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
    private readonly measurements: MeasurementRepository,
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
      // The same hours as regular sensor measurements: markers, the card and charts read these
      const stations = new Map(source.stations.map((st) => [st.id, st]));
      const docs = latest
        .map((r) => {
          const st = stations.get(r.station_id);
          return st ? toSensorMeasurement(source, st, r) : null;
        })
        .filter((d): d is Measurement => d !== null);
      if (docs.length) await this.measurements.upsertMany(docs);
      if (added) this.logger.log(`${source.id}: ${added} new station-hours`);
    } catch (e) {
      this.logger.warn(`${source.id}: ${(e as Error).message}`);
    }
  }
}
