// Copies government stations from the main database (gov_stations, gov_measurements, gov_sources, RoSeMAN
// ≤ 1.5.0) into the feeds database (feed_stations, feed_readings, feed_sources; FEEDS_MONGODB_URI).
//
//   node dist/scripts/feeds-migrate.js
//
// Copies only: nothing is deleted, so the old map keeps working; run it again any time, it upserts.
// A station keeps the area the fetcher gave it; one copied fresh gets its source as area until the next
// station refresh (once a day, and on fetcher start) splits AirNow into its regions.
import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { AnyBulkWriteOperation, Connection } from 'mongoose';
import { appConfig, govStationsConfig } from '../config/index.js';
import {
  FEEDS_CONNECTION,
  feedsMongooseModule,
} from '../database/feeds-connection.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, govStationsConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('app.mongodbUri'),
      }),
    }),
    feedsMongooseModule(),
  ],
})
class FeedsMigrateModule {}

const BATCH = 2000;
type Doc = Record<string, unknown>;

async function copy(
  logger: Logger,
  from: Connection,
  to: Connection,
  names: [string, string],
  op: (d: Doc) => AnyBulkWriteOperation<Doc>,
): Promise<void> {
  const target = to.db.collection<Doc>(names[1]);
  let batch: AnyBulkWriteOperation<Doc>[] = [];
  let n = 0;
  for await (const d of from.db
    .collection<Doc>(names[0])
    .find({}, { projection: { _id: 0, __v: 0 } })) {
    batch.push(op(d));
    if (batch.length === BATCH) {
      await target.bulkWrite(batch, { ordered: false });
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) await target.bulkWrite(batch, { ordered: false });
  n += batch.length;
  logger.log(`${names[0]} → ${names[1]}: ${n}`);
}

async function run(): Promise<void> {
  const logger = new Logger('FeedsMigrate');
  const app = await NestFactory.createApplicationContext(FeedsMigrateModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const main = app.get<Connection>(getConnectionToken());
    const feeds = app.get<Connection>(getConnectionToken(FEEDS_CONNECTION));
    logger.log(`from ${main.db.databaseName} to ${feeds.db.databaseName}`);

    await copy(logger, main, feeds, ['gov_stations', 'feed_stations'], (d) => {
      const { area, last_ts, ...rest } = d;
      void area;
      void last_ts;
      return {
        updateOne: {
          filter: { id: d.id },
          update: { $set: rest, $setOnInsert: { area: d.source } },
          upsert: true,
        },
      };
    });
    await copy(
      logger,
      main,
      feeds,
      ['gov_measurements', 'feed_readings'],
      (d) => ({
        updateOne: {
          filter: { station_id: d.station_id, timestamp: d.timestamp },
          update: { $set: d },
          upsert: true,
        },
      }),
    );
    await copy(logger, main, feeds, ['gov_sources', 'feed_sources'], (d) => ({
      updateOne: { filter: { id: d.id }, update: { $set: d }, upsert: true },
    }));

    const newest = await feeds.db
      .collection('feed_readings')
      .aggregate<{ _id: string; ts: number }>([
        { $group: { _id: '$station_id', ts: { $max: '$timestamp' } } },
      ])
      .toArray();
    if (newest.length) {
      await feeds.db.collection('feed_stations').bulkWrite(
        newest.map((r) => ({
          updateOne: {
            filter: { id: r._id },
            update: { $max: { last_ts: r.ts } },
          },
        })),
        { ordered: false },
      );
    }
    logger.log(`last_ts set on ${newest.length} stations; done.`);
  } finally {
    await app.close();
  }
}

run().catch((err: unknown) => {
  new Logger('FeedsMigrate').error(
    'Migration failed',
    err instanceof Error ? err.stack : String(err),
  );
  process.exitCode = 1;
});
