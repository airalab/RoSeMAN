import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service.js';

/** Запускает каноническую CPS-проекцию локаций и reverse geocoding. */
@Module({ providers: [GeocodingService] })
export class GeocodingModule {}
