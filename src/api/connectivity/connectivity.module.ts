import { Module } from '@nestjs/common';
import { ConnectivityController } from './connectivity.controller.js';
import { ConnectivityService } from './connectivity.service.js';

/** Регистрирует публичный API Connectivity Protocol v3. */
@Module({
  controllers: [ConnectivityController],
  providers: [ConnectivityService],
})
export class ConnectivityModule {}
