import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';

/**
 * Government stations and other public data feeds live in their own database (FEEDS_MONGODB_URI): the
 * database of our devices holds only what citizens' sensors send. Without FEEDS_MONGODB_URI the feeds share
 * the main database, in their own feed_* collections.
 */
export const FEEDS_CONNECTION = 'feeds';

export function feedsMongooseModule() {
  return MongooseModule.forRootAsync({
    connectionName: FEEDS_CONNECTION,
    inject: [ConfigService],
    useFactory: (cfg: ConfigService) => ({
      uri:
        cfg.get<string>('govStations.mongodbUri') ||
        cfg.get<string>('app.mongodbUri'),
      // small collections of our own: unlike the main database, indexes are built on start
      autoIndex: true,
    }),
  });
}
