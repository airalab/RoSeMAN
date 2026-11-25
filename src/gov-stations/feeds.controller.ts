import {
  BadRequestException,
  Controller,
  Get,
  Header,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { GovMeasurementRepository } from '../database/repositories/gov-measurement.repository.js';
import { GovSourceRepository } from '../database/repositories/gov-source.repository.js';
import { GovStationRepository } from '../database/repositories/gov-station.repository.js';
import { areaName } from './areas.js';
import { type FeedMarker, feedMarkers } from './feed-markers.js';
import { toMapUnits } from './projection.js';
import { GOV_SOURCES } from './sources/index.js';
import type { GovSource } from './sources/types.js';

/** A station silent for this long is no longer on the map. */
const ACTIVE_S = 24 * 3600;
const MAX_MARKER_WINDOW_S = 7 * 24 * 3600;
const MAX_HISTORY_S = 31 * 24 * 3600;
const CATALOG_TTL_MS = 60_000;

export interface FeedAreaView {
  id: string;
  name: string;
  stations: number;
  bbox: [number, number, number, number];
}

export interface FeedView {
  id: string;
  network: string;
  publisher: string;
  url: string;
  country: string;
  note: string;
  areas: FeedAreaView[];
}

const NOTE =
  'Public data of a government air quality monitoring network, hourly means as published, shown in the units of the map: PM in μg/m³, NO₂ and O₃ in ppb, CO in ppm.';

function window(
  fromRaw: string | undefined,
  toRaw: string | undefined,
  def: number,
  max: number,
): [number, number] {
  const now = Math.floor(Date.now() / 1000);
  const to = Number(toRaw) || now;
  const from = Number(fromRaw) || to - def;
  if (from > to || to - from > max) {
    throw new BadRequestException(`from/to: at most ${max / 86400} days`);
  }
  return [from, to];
}

/**
 * Public data feeds — government stations — kept apart from our devices (feeds database). The map asks for the
 * catalog once, and for one area's markers only after the visitor chose to see that area.
 */
@Controller('v2/feeds')
export class FeedsController {
  private catalog: { at: number; value: Promise<FeedView[]> } | null = null;

  constructor(
    private readonly readings: GovMeasurementRepository,
    private readonly stations: GovStationRepository,
    private readonly switches: GovSourceRepository,
  ) {}

  /** Feeds with a station heard from in the last 24 h, each with its areas: name, station count, bbox. */
  @Get()
  @Header('Cache-Control', 'public, max-age=60')
  async list(): Promise<{ result: FeedView[] }> {
    if (!this.catalog || Date.now() - this.catalog.at > CATALOG_TTL_MS) {
      const value = this.buildCatalog();
      value.catch(() => (this.catalog = null));
      this.catalog = { at: Date.now(), value };
    }
    return { result: await this.catalog.value };
  }

  private async buildCatalog(): Promise<FeedView[]> {
    const since = Math.floor(Date.now() / 1000) - ACTIVE_S;
    const [areas, off] = await Promise.all([
      this.stations.areas(since),
      this.switches.disabled(),
    ]);
    const result: FeedView[] = [];
    for (const s of GOV_SOURCES) {
      if (off.has(s.id)) continue;
      const own = areas.filter((a) => a.source === s.id);
      if (!own.length) continue;
      result.push({
        id: s.id,
        network: s.network,
        publisher: s.publisher,
        url: s.url,
        country: s.country,
        note: NOTE,
        areas: own.map((a) => ({
          id: a.area,
          name: areaName(s, a.area),
          stations: a.stations,
          bbox: a.bbox,
        })),
      });
    }
    return result;
  }

  /** Markers of one area: newest hour and highest hour per quantity within from/to (default: last 24 h). */
  @Get('areas/:area/markers')
  @Header('Cache-Control', 'public, max-age=300')
  async markers(
    @Param('area') area: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ): Promise<{ result: FeedMarker[] }> {
    const source = await this.sourceOf(area);
    const [from, to] = window(fromRaw, toRaw, 24 * 3600, MAX_MARKER_WINDOW_S);
    const list = await this.stations.findByArea(area, from - ACTIVE_S);
    const rows = await this.readings.window(
      list.map((s) => s.id),
      from,
      to,
    );
    return { result: feedMarkers(source, list, rows) };
  }

  /** Hourly series of one station for its card, in the map's units. */
  @Get('stations/:id/history')
  @Header('Cache-Control', 'public, max-age=300')
  async history(
    @Param('id') id: string,
    @Query('from') fromRaw?: string,
    @Query('to') toRaw?: string,
  ): Promise<{
    result: Array<{ timestamp: number; values: Record<string, number> }>;
  }> {
    const [station] = await this.stations.findByIds([id]);
    if (!station) throw new NotFoundException('unknown station');
    const source = await this.sourceOf(station.area);
    const [from, to] = window(fromRaw, toRaw, 24 * 3600, MAX_HISTORY_S);
    const rows = await this.readings.history(id, from, to);
    return {
      result: rows.map((r) => ({
        timestamp: r.timestamp,
        values: toMapUnits(source, r.values),
      })),
    };
  }

  private async sourceOf(area: string): Promise<GovSource> {
    const id = area.split(':')[0];
    const source = GOV_SOURCES.find((s) => s.id === id);
    if (!source || (await this.switches.disabled()).has(id)) {
      throw new NotFoundException('unknown feed');
    }
    return source;
  }
}
