// ВАЖНО: env-bootstrap должен быть ПЕРВЫМ импортом — он вызывает dotenv.config()
// как side-effect и обязан отработать до загрузки AppModule (где ConfigModule.forRoot
// читает .env при evaluation декоратора).
import 'robonomics-api-augment';
import './env-bootstrap.js';

import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AllExceptionsFilter } from './api/common/filters/http-exception.filter.js';
import { AppModule } from './app.module.js';

function flag(name: string): 'enabled' | 'disabled' {
  return process.env[name] !== 'false' ? 'enabled' : 'disabled';
}

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const apiEnabled = process.env.API_ENABLED !== 'false';

  const logModules = (): void => {
    logger.log(
      `Modules — api: ${flag('API_ENABLED')}, ` +
        `indexer: ${flag('INDEXER_ENABLED')}, ` +
        `measurement: ${flag('MEASUREMENT_ENABLED')}, ` +
        `geocoding: ${flag('GEOCODING_ENABLED')}`,
    );
  };

  if (!apiEnabled) {
    // API отключен — работаем в headless-режиме, HTTP-сервер не нужен.
    const app = await NestFactory.createApplicationContext(AppModule);
    app.enableShutdownHooks();
    logger.log('RoSeMAN running in headless mode (API disabled)');
    logModules();
    return;
  }

  const app = await NestFactory.create(AppModule);

  app.enableCors();

  app.setGlobalPrefix('api', {
    exclude: ['/metrics'],
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port', 3000);

  app.enableShutdownHooks();

  await app.listen(port);
  logger.log(`RoSeMAN is running on port ${port}`);
  logModules();
}

void bootstrap();
