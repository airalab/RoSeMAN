import { Module } from '@nestjs/common';
import { RobonomicsService } from './robonomics.service.js';

/** Одно соединение с Robonomics для индексатора и обработчика CPS. */
@Module({
  providers: [RobonomicsService],
  exports: [RobonomicsService],
})
export class RobonomicsApiModule {}
