import { Module } from '@nestjs/common';
import { GeocodingService } from './geocoding.service.js';

@Module({
  providers: [GeocodingService],
})
export class GeocodingModule {}
