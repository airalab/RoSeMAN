import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { appConfig, cpsConfig, ipfsConfig } from '../config/index.js';
import { DatabaseModule } from '../database/database.module.js';
import { ConnectivityRecordMapper } from '../measurement/connectivity-record.mapper.js';
import { CpsBackfillService } from '../measurement/cps-backfill.service.js';
import { IpfsFetcherService } from '../measurement/ipfs-fetcher.service.js';
import { parseCpsBackfillOptions } from './cps-backfill.options.js';

/** Минимальный application context для canonical backfill без фоновых pollers. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, ipfsConfig, cpsConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.get<string>('app.mongodbUri'),
        autoIndex: false,
      }),
    }),
    DatabaseModule,
  ],
  providers: [IpfsFetcherService, ConnectivityRecordMapper, CpsBackfillService],
})
class CpsBackfillModule {}

/** Запускает один ограниченный backfill batch и печатает JSON-отчёт. */
async function run(): Promise<void> {
  const logger = new Logger('CpsBackfill');
  const options = parseCpsBackfillOptions(process.argv.slice(2));
  const app = await NestFactory.createApplicationContext(CpsBackfillModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(CpsBackfillService).run(options);
    logger.log(JSON.stringify(report));
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  new Logger('CpsBackfill').error(
    'CPS backfill failed',
    error instanceof Error ? error.stack : String(error),
  );
  process.exitCode = 1;
});
