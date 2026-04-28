import { Module } from '@nestjs/common';
import { SensorV2Controller } from './sensor-v2.controller.js';
import { SensorController } from './sensor.controller.js';
import { SensorService } from './sensor.service.js';

@Module({
  controllers: [SensorController, SensorV2Controller],
  providers: [SensorService],
})
export class SensorModule {}
