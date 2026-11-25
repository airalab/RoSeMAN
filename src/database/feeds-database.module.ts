import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { FEEDS_CONNECTION } from './feeds-connection.js';
import { GovMeasurementRepository } from './repositories/gov-measurement.repository.js';
import { GovSourceRepository } from './repositories/gov-source.repository.js';
import { GovStationRepository } from './repositories/gov-station.repository.js';
import {
  GovMeasurement,
  GovMeasurementSchema,
} from './schemas/gov-measurement.schema.js';
import {
  GovSourceState,
  GovSourceStateSchema,
} from './schemas/gov-source.schema.js';
import {
  GovStationEntry,
  GovStationSchema,
} from './schemas/gov-station.schema.js';

/** Repositories of the feeds database (feeds-connection.ts); needs feedsMongooseModule() next to it. */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature(
      [
        { name: GovMeasurement.name, schema: GovMeasurementSchema },
        { name: GovSourceState.name, schema: GovSourceStateSchema },
        { name: GovStationEntry.name, schema: GovStationSchema },
      ],
      FEEDS_CONNECTION,
    ),
  ],
  providers: [
    GovMeasurementRepository,
    GovSourceRepository,
    GovStationRepository,
  ],
  exports: [
    GovMeasurementRepository,
    GovSourceRepository,
    GovStationRepository,
  ],
})
export class FeedsDatabaseModule {}
