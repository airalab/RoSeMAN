import { Module } from '@nestjs/common';
import { GovStationsController } from './gov-stations.controller.js';
import { GovStationsFetchService } from './gov-stations-fetch.service.js';

/** Read API: GET /api/v2/gov/stations and /api/v2/gov/stations/:id/history */
@Module({ controllers: [GovStationsController] })
export class GovStationsApiModule {}

/** Fetcher: polls the national networks' sites (GOV_STATIONS_ENABLED=true). */
@Module({ providers: [GovStationsFetchService] })
export class GovStationsFetchModule {}
