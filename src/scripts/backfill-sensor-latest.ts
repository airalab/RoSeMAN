// One-off fill of sensor_latest from history, before markers start reading it (SENSOR_LATEST_READS=true).
//
//   npm run backfill-sensor-latest              # sensors seen in the last 30 days
//   BACKFILL_DAYS=90 npm run backfill-sensor-latest
//
// Each sensor's newest measurement is read through the (sensor_id, timestamp) index and written with
// MeasurementRepository.updateLatest — the same update live writes use, so a run racing live traffic,
// or run twice, never moves a row back in time.
import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { appConfig } from '../config/index.js';
import { DatabaseModule } from '../database/database.module.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import {
  Measurement,
  type MeasurementDocument,
} from '../database/schemas/measurement.schema.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [appConfig] }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('app.mongodbUri'),
      }),
    }),
    DatabaseModule,
  ],
})
class BackfillModule {}

const BATCH = 200;

async function run(): Promise<void> {
  const logger = new Logger('BackfillSensorLatest');
  const days = Number(process.env.BACKFILL_DAYS) || 30;
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const model = app.get<Model<MeasurementDocument>>(
      getModelToken(Measurement.name),
    );
    const repo = app.get(MeasurementRepository);
    const since = Math.floor(Date.now() / 1000) - days * 86400;
    const ids: string[] = await model.distinct('sensor_id', {
      timestamp: { $gte: since },
    });
    logger.log(`${ids.length} sensors with data in the last ${days} days`);
    for (let i = 0; i < ids.length; i += BATCH) {
      const newest = await Promise.all(
        ids
          .slice(i, i + BATCH)
          .map((id) =>
            model
              .findOne({ sensor_id: id })
              .sort({ timestamp: -1 })
              .lean<Measurement>(),
          ),
      );
      await repo.updateLatest(newest.filter((d): d is Measurement => !!d));
      logger.log(`${Math.min(i + BATCH, ids.length)} / ${ids.length}`);
    }
    logger.log('sensor_latest filled.');
  } finally {
    await app.close();
  }
}

run().catch((err: unknown) => {
  new Logger('BackfillSensorLatest').error(
    'Backfill failed',
    err instanceof Error ? err.stack : String(err),
  );
  process.exitCode = 1;
});
