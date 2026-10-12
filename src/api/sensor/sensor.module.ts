import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { SensorV2Controller } from './sensor-v2.controller.js';
import { SensorController } from './sensor.controller.js';
import { SensorService } from './sensor.service.js';

/**
 * Предоставляет API поверх legacy-коллекций measurements и cities.
 * @deprecated Используйте ConnectivityModule и API V3.
 */
@Module({
  controllers: [SensorController, SensorV2Controller],
  providers: [SensorService],
})
export class SensorModule implements OnModuleInit {
  private readonly logger = new Logger(SensorModule.name);

  /** Сообщает оператору о запуске устаревшего API совместимости. */
  onModuleInit(): void {
    this.logger.warn(
      'Deprecated Sensor API is active; use Connectivity API V3 for new integrations',
    );
  }
}
