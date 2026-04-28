import {
  Module,
  type DynamicModule,
  type ForwardReference,
  type Type,
} from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { SensorModule } from './api/sensor/sensor.module.js';
import { StatusModule } from './api/status/status.module.js';
import { StoryModule } from './api/story/story.module.js';
import {
  appConfig,
  geocodingConfig,
  ipfsConfig,
  robonomicsConfig,
} from './config/index.js';
import { DatabaseModule } from './database/database.module.js';
import { GeocodingModule } from './geocoding/geocoding.module.js';
import { MeasurementModule } from './measurement/measurement.module.js';
import { MetricsModule } from './metrics/metrics.module.js';
import { RobonomicsModule } from './robonomics/robonomics.module.js';

/**
 * Собирает список импортируемых модулей.
 *
 * Флаги окружения (все по умолчанию включены):
 * - `API_ENABLED` — StatusModule, SensorModule, StoryModule (REST API).
 * - `INDEXER_ENABLED` — RobonomicsModule (сканирование блоков).
 * - `MEASUREMENT_ENABLED` — MeasurementModule (обработка IPFS-записей в measurements).
 * - `GEOCODING_ENABLED` — GeocodingModule (обратное геокодирование сенсоров).
 *
 * Выставив нужные флаги в `false`, можно запускать отдельные инстансы:
 * индексатор, обработчик IPFS, геокодер, REST API — в любых комбинациях.
 */
function buildImports(): Array<
  Type | DynamicModule | Promise<DynamicModule> | ForwardReference
> {
  const modules: Array<
    Type | DynamicModule | Promise<DynamicModule> | ForwardReference
  > = [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [appConfig, robonomicsConfig, ipfsConfig, geocodingConfig],
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        uri: cfg.get<string>('app.mongodbUri'),
      }),
    }),
    DatabaseModule,
  ];

  if (process.env.API_ENABLED !== 'false') {
    modules.push(
      StatusModule,
      SensorModule,
      StoryModule,
      MetricsModule,
      PrometheusModule.register({
        defaultMetrics: {
          enabled: false, // отключаем дефолтные метрики Node.js
        },
        path: '/metrics', // эндпоинт для Prometheus
      }),
    );
  }

  if (process.env.INDEXER_ENABLED !== 'false') {
    modules.push(RobonomicsModule);
  }

  if (process.env.MEASUREMENT_ENABLED !== 'false') {
    modules.push(MeasurementModule);
  }

  if (process.env.GEOCODING_ENABLED !== 'false') {
    modules.push(GeocodingModule);
  }

  return modules;
}

@Module({ imports: buildImports() })
export class AppModule {}
