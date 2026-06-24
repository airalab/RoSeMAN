// Одноразовый скрипт поиска и удаления дублей в коллекции measurements.
//
// Дубль — несколько документов с одинаковыми (sensor_id, timestamp). В каждой
// такой группе оставляется один документ (с максимальным _id — самая свежая
// вставка), остальные удаляются. После чистки можно создать unique-индекс
// { sensor_id: 1, timestamp: 1 }.
//
// Запуск:
//   npm run dedup-measurements               # реальное удаление
//   npm run dedup-measurements -- --dry-run  # только подсчёт, без удаления
//   DOTENV_CONFIG_PATH=.env.kusama npm run dedup-measurements
//
// Обработка идёт по одному сенсору (через индекс sensor_id_1), чтобы не строить
// гигантскую группировку по всей коллекции.
import 'robonomics-api-augment';
import '../env-bootstrap.js';

import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import type { AnyBulkWriteOperation, Model, Types } from 'mongoose';
import { appConfig } from '../config/index.js';
import { DatabaseModule } from '../database/database.module.js';
import {
  Measurement,
  type MeasurementDocument,
} from '../database/schemas/measurement.schema.js';

/**
 * Минимальный модуль: подключение к MongoDB + все схемы (через `DatabaseModule`).
 * HTTP-сервер, индексатор и поллеры не поднимаются.
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
class DedupModule {}

/** Группа дублей по одному сенсору: измерения с одинаковым timestamp. */
interface DupGroup {
  /** timestamp группы. */
  _id: number;
  /** _id всех документов группы. */
  ids: Types.ObjectId[];
  /** _id документа, который оставляем (самый свежий по вставке). */
  keep: Types.ObjectId;
  /** размер группы (>= 2). */
  n: number;
}

/** Размер батча удаления (bulkWrite). */
const DELETE_BATCH = 1000;
/** Печатать прогресс каждые N обработанных сенсоров. */
const PROGRESS_EVERY = 500;

/**
 * Проходит по всем сенсорам, находит дубли по (sensor_id, timestamp)
 * и удаляет лишние документы батчами, логируя ход и итог работы.
 */
async function run(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const logger = new Logger('DedupMeasurements');
  const app = await NestFactory.createApplicationContext(DedupModule, {
    logger: ['error', 'warn', 'log'],
  });

  const startedAt = Date.now();

  try {
    const model = app.get<Model<MeasurementDocument>>(
      getModelToken(Measurement.name),
    );

    logger.log(
      dryRun
        ? 'DRY RUN — ничего не удаляется, только подсчёт'
        : 'Режим удаления дублей',
    );

    const sensorIds = await model.distinct<string>('sensor_id').exec();
    logger.log(`Сенсоров для проверки: ${sensorIds.length}`);

    let processed = 0;
    let sensorsWithDups = 0;
    let dupGroupsTotal = 0;
    let removedTotal = 0;

    let pending: AnyBulkWriteOperation<MeasurementDocument>[] = [];

    /** Сбрасывает накопленный батч удалений (или считает его в dry-run). */
    const flush = async (): Promise<void> => {
      if (pending.length === 0) return;
      if (dryRun) {
        removedTotal += pending.length;
      } else {
        const res = await model.bulkWrite(pending, { ordered: false });
        removedTotal += res.deletedCount ?? 0;
      }
      pending = [];
    };

    for (const sid of sensorIds) {
      const groups = await model
        .aggregate<DupGroup>(
          [
            { $match: { sensor_id: sid } },
            {
              $group: {
                _id: '$timestamp',
                ids: { $push: '$_id' },
                keep: { $max: '$_id' },
                n: { $sum: 1 },
              },
            },
            { $match: { n: { $gt: 1 } } },
          ],
          { allowDiskUse: true },
        )
        .exec();

      if (groups.length > 0) {
        sensorsWithDups++;
        let removedForSensor = 0;

        for (const group of groups) {
          dupGroupsTotal++;
          for (const id of group.ids) {
            if (id.equals(group.keep)) continue;
            pending.push({ deleteOne: { filter: { _id: id } } });
            removedForSensor++;
            if (pending.length >= DELETE_BATCH) await flush();
          }
        }

        logger.log(
          `sensor ${sid}: групп с дублями=${groups.length}, ` +
            `${dryRun ? 'к удалению' : 'удалено'}=${removedForSensor}`,
        );
      }

      if (++processed % PROGRESS_EVERY === 0) {
        logger.log(
          `... прогресс: ${processed}/${sensorIds.length} сенсоров, ` +
            `найдено к удалению: ${removedTotal + pending.length}`,
        );
      }
    }

    await flush();

    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    logger.log('───────────────── ИТОГ ─────────────────');
    logger.log(
      `Режим:               ${dryRun ? 'DRY RUN (без удаления)' : 'удаление'}`,
    );
    logger.log(`Сенсоров проверено:  ${processed}`);
    logger.log(`Сенсоров с дублями:  ${sensorsWithDups}`);
    logger.log(`Групп с дублями:     ${dupGroupsTotal}`);
    logger.log(
      `Документов ${dryRun ? 'к удалению' : 'удалено'}: ${removedTotal}`,
    );
    logger.log(`Время:               ${elapsed}s`);
    logger.log('─────────────────────────────────────────');
    if (dryRun) {
      logger.log('Повторите без --dry-run, чтобы удалить найденные дубли.');
    } else {
      logger.log(
        'Готово. Теперь можно создать unique-индекс ' +
          '{ sensor_id: 1, timestamp: 1 } (npm run sync-indexes или вручную).',
      );
    }
  } finally {
    await app.close();
  }
}

run().catch((err: unknown) => {
  new Logger('DedupMeasurements').error(
    'Dedup failed',
    err instanceof Error ? err.stack : String(err),
  );
  process.exitCode = 1;
});
