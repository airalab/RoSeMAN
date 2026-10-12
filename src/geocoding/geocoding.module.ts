import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { GeocodingService } from './geocoding.service.js';

/**
 * Запускает геокодирование legacy-коллекции cities.
 * @deprecated Canonical Connectivity storage не требует этой проекции.
 */
@Module({
  providers: [GeocodingService],
})
export class GeocodingModule implements OnModuleInit {
  private readonly logger = new Logger(GeocodingModule.name);

  /** Сообщает оператору о запуске legacy-геокодирования. */
  onModuleInit(): void {
    this.logger.warn(
      'Deprecated geocoding for the legacy cities projection is active',
    );
  }
}
