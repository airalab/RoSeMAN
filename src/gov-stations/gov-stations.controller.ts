import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Query,
} from '@nestjs/common';
import { GovMeasurementRepository } from '../database/repositories/gov-measurement.repository.js';
import { GOV_SOURCES } from './sources/index.js';
import type { GovStation } from './sources/types.js';

/** Readings older than this are not "latest" any more: the station is shown without data. */
const LATEST_WINDOW_S = 24 * 3600;
const MAX_HISTORY_S = 31 * 24 * 3600;

export interface GovStationView extends GovStation {
  source: string;
  timestamp: number | null;
  values: Record<string, number>;
}

export interface GovSourceView {
  id: string;
  publisher: string;
  url: string;
  country: string;
  note: string;
  stations: GovStationView[];
}

@Controller('v2/gov')
export class GovStationsController {
  constructor(private readonly readings: GovMeasurementRepository) {}

  /** Every source with stored data, its stations and their latest hour. */
  @Get('stations')
  async stations(): Promise<{ result: GovSourceView[] }> {
    const since = Math.floor(Date.now() / 1000) - LATEST_WINDOW_S;
    const latest = new Map(
      (await this.readings.latest(since)).map((r) => [r.station_id, r]),
    );
    const result = GOV_SOURCES.filter((s) =>
      s.stations.some((st) => latest.has(st.id)),
    ).map((s) => ({
      id: s.id,
      publisher: s.publisher,
      url: s.url,
      country: s.country,
      note: 'Public data of the national air quality monitoring network, hourly means, μg/m³, republished as is.',
      stations: s.stations.map((st) => {
        const r = latest.get(st.id);
        return {
          ...st,
          source: s.id,
          timestamp: r?.timestamp ?? null,
          values: r?.values ?? {},
        };
      }),
    }));
    return { result };
  }

  /** Hourly history of one station, `from`/`to` in epoch seconds (default: the last 24 h). */
  @Get('stations/:id/history')
  async history(
    @Param('id') id: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ): Promise<{
    result: Array<{ timestamp: number; values: Record<string, number> }>;
  }> {
    if (!GOV_SOURCES.some((s) => s.stations.some((st) => st.id === id))) {
      throw new BadRequestException('unknown station');
    }
    const now = Math.floor(Date.now() / 1000);
    const to = Number(toRaw) || now;
    const from = Number(fromRaw) || to - 24 * 3600;
    if (from > to || to - from > MAX_HISTORY_S) {
      throw new BadRequestException('from/to: at most 31 days');
    }
    const rows = await this.readings.history(id, from, to);
    return {
      result: rows.map((r) => ({ timestamp: r.timestamp, values: r.values })),
    };
  }
}
