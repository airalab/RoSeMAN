// Скрипт разовой синхронизации индексов MongoDB со схемами Mongoose.
//
// Запуск (по умолчанию читает .env):
//   npm run sync-indexes
// Для другого окружения:
//   DOTENV_CONFIG_PATH=.env.kusama npm run sync-indexes
//
// ВНИМАНИЕ: syncIndexes() создаёт недостающие индексы И УДАЛЯЕТ те, которых
// больше нет в схеме. На больших «горячих» коллекциях предпочтительнее ручное
// создание через mongosh с фоновым построением — см. docs/database.md.
import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { appConfig } from '../config/index.js';
import { DatabaseModule } from '../database/database.module.js';

/**
 * Минимальный модуль для синхронизации индексов: только подключение к MongoDB
 * и регистрация всех схем (через `DatabaseModule`). HTTP-сервер, индексатор и
 * поллеры намеренно не поднимаются.
 */
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
class SyncIndexesModule {}

/**
 * Поднимает контекст приложения, проходит по всем зарегистрированным моделям
 * и вызывает `syncIndexes()` для каждой, после чего закрывает соединение.
 */
async function run(): Promise<void> {
  const logger = new Logger('SyncIndexes');
  const app = await NestFactory.createApplicationContext(SyncIndexesModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const connection = app.get<Connection>(getConnectionToken());
    const modelNames = connection.modelNames();

    logger.log(`Synchronizing indexes for ${modelNames.length} model(s)...`);

    for (const name of modelNames) {
      const dropped = await connection.model(name).syncIndexes();
      logger.log(
        dropped.length > 0
          ? `  ${name}: dropped stale index(es) → ${dropped.join(', ')}`
          : `  ${name}: up to date`,
      );
    }

    logger.log('Indexes synchronized.');
  } finally {
    await app.close();
  }
}

run().catch((err: unknown) => {
  new Logger('SyncIndexes').error(
    'Index synchronization failed',
    err instanceof Error ? err.stack : String(err),
  );
  process.exitCode = 1;
});
