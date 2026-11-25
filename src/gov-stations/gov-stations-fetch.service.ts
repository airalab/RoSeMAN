import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GovMeasurementRepository } from '../database/repositories/gov-measurement.repository.js';
import { GovSourceRepository } from '../database/repositories/gov-source.repository.js';
import { GovStationRepository } from '../database/repositories/gov-station.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { toSensorMeasurement } from './projection.js';
import { selectSources } from './sources/index.js';
import type { GovSource, GovStation } from './sources/types.js';

/** Station lists change rarely: re-read them once a day. */
const STATIONS_TTL_MS = 24 * 3600_000;

interface FetchConfig {
  sources: string[];
  pollInterval: number;
  timeoutMs: number;
  legacyProjection: boolean;
}

/**
 * Polls every source of GOV_STATIONS_SOURCES that is not switched off (feed_sources) and stores its latest hour
 * (GOV_STATIONS_ENABLED=true) as published, in the feeds database: feed_readings, and the station's newest hour
 * in feed_stations. With GOV_STATIONS_LEGACY_PROJECTION=true also as a regular sensor in measurements
 * (projection.ts), for a map that still reads government stations from there.
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
  private readonly stations = new Map<
    string,
    { at: number; list: GovStation[] }
  >();

  constructor(
    config: ConfigService,
    private readonly readings: GovMeasurementRepository,
    private readonly measurements: MeasurementRepository,
    private readonly stationRepo: GovStationRepository,
    private readonly switches: GovSourceRepository,
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
      const off = await this.switches.disabled();
      await Promise.all(
        this.sources.filter((s) => !off.has(s.id)).map((s) => this.fetchOne(s)),
      );
    } finally {
      this.running = false;
    }
  }

  /** The source's stations: from memory, else fresh from the source (once a day), else from the DB. */
  private async stationsOf(source: GovSource): Promise<GovStation[]> {
    const cached = this.stations.get(source.id);
    if (cached && Date.now() - cached.at < STATIONS_TTL_MS) return cached.list;
    try {
      const list = await source.fetchStations(this.cfg.timeoutMs);
      if (list.length) {
        await this.stationRepo.upsertMany(source.id, list);
        this.stations.set(source.id, { at: Date.now(), list });
        this.logger.log(`${source.id}: ${list.length} stations`);
        return list;
      }
    } catch (e) {
      this.logger.warn(`${source.id} stations: ${(e as Error).message}`);
    }
    const stored = await this.stationRepo.findBySource(source.id);
    // retry the source in an hour rather than a day when it failed
    if (stored.length)
      this.stations.set(source.id, {
        at: Date.now() - STATIONS_TTL_MS + 3600_000,
        list: stored,
      });
    return stored;
  }

  private async fetchOne(source: GovSource): Promise<void> {
    try {
      const stationList = await this.stationsOf(source);
      if (!stationList.length) return;
      const latest = await source.fetchLatest(this.cfg.timeoutMs, stationList);
      const added = await this.readings.upsertMany(
        latest.map((r) => ({ ...r, source: source.id })),
      );
      const newest = new Map<string, number>();
      for (const r of latest) {
        newest.set(
          r.station_id,
          Math.max(newest.get(r.station_id) ?? 0, r.timestamp),
        );
      }
      await this.stationRepo.touch(newest);
      if (added) this.logger.log(`${source.id}: ${added} new station-hours`);
      if (!this.cfg.legacyProjection) return;
      // The same hours as regular sensor measurements: markers, the card and charts read these
      const stations = new Map(stationList.map((st) => [st.id, st]));
      const docs = latest
        .map((r) => {
          const st = stations.get(r.station_id);
          return st ? toSensorMeasurement(source, st, r) : null;
        })
        .filter((d): d is Measurement => d !== null);
      if (docs.length) await this.measurements.upsertMany(docs);
    } catch (e) {
      this.logger.warn(`${source.id}: ${(e as Error).message}`);
    }
  }
}
