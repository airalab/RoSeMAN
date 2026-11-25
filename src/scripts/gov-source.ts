// Switch a government source off the map, or back on, without a restart (feed_sources, feeds database):
//
//   node dist/scripts/gov-source.js                 # every known source and whether it is on
//   node dist/scripts/gov-source.js off us-airnow   # not polled; its stations leave the map within a minute
//   node dist/scripts/gov-source.js on us-airnow
//
// Stored readings stay; switching back on shows the stations again with their history.
import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { appConfig, govStationsConfig } from '../config/index.js';
import { feedsMongooseModule } from '../database/feeds-connection.js';
import { FeedsDatabaseModule } from '../database/feeds-database.module.js';
import { GovSourceRepository } from '../database/repositories/gov-source.repository.js';
import { GOV_SOURCES } from '../gov-stations/sources/index.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, govStationsConfig],
    }),
    feedsMongooseModule(),
    FeedsDatabaseModule,
  ],
})
class GovSourceCliModule {}

async function run(): Promise<void> {
  const [action, id] = process.argv.slice(2);
  if (action && (!['on', 'off'].includes(action) || !id)) {
    throw new Error('usage: gov-source.js [on|off <source id>]');
  }
  if (id && !GOV_SOURCES.some((s) => s.id === id)) {
    throw new Error(
      `unknown source ${id}; known: ${GOV_SOURCES.map((s) => s.id).join(', ')}`,
    );
  }
  const app = await NestFactory.createApplicationContext(GovSourceCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const repo = app.get(GovSourceRepository);
    if (action) await repo.setEnabled(id, action === 'on');
    const off = await repo.disabled();
    for (const s of GOV_SOURCES) {
      console.log(`${off.has(s.id) ? 'off' : 'on '}  ${s.id}  ${s.publisher}`);
    }
  } finally {
    await app.close();
  }
}

run().catch((err: unknown) => {
  new Logger('GovSource').error(
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
});
