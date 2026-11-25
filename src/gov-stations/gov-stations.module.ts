import { Module } from '@nestjs/common';
import { GovStationsController } from './gov-stations.controller.js';
import { GovStationsFetchService } from './gov-stations-fetch.service.js';
import { FeedsController } from './feeds.controller.js';

/**
 * Read API: GET /api/v2/feeds/* (catalog, area markers, station history) and the older
 * GET /api/v2/gov/stations(/:id/history) for the map that reads government stations as sensors.
 */
@Module({ controllers: [FeedsController, GovStationsController] })
export class GovStationsApiModule {}

/** Fetcher: polls the national networks' sites (GOV_STATIONS_ENABLED=true). */
@Module({ providers: [GovStationsFetchService] })
export class GovStationsFetchModule {}
