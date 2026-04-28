import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SensorRepository } from '../database/repositories/sensor.repository.js';

interface NominatimAddress {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  state?: string;
  county?: string;
  state_district?: string;
  region?: string;
  country?: string;
}

interface NominatimResponse {
  address?: NominatimAddress;
}

/**
 * Фоновый сервис геокодирования сенсоров через Nominatim reverse geocoding API.
 * Поллит коллекцию sensor на записи с city === null и обогащает их данными
 * о местоположении (city, state, country).
 */
@Injectable()
export class GeocodingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeocodingService.name);
  private timer?: ReturnType<typeof setInterval>;

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly requestInterval: number;
  private readonly fetchTimeout: number;
  private readonly pollInterval: number;
  private readonly batchSize: number;

  constructor(
    private readonly config: ConfigService,
    private readonly sensorRepo: SensorRepository,
  ) {
    this.baseUrl = this.config.get<string>('geocoding.baseUrl')!;
    this.userAgent = this.config.get<string>('geocoding.userAgent')!;
    this.requestInterval = this.config.get<number>(
      'geocoding.requestInterval',
    )!;
    this.fetchTimeout = this.config.get<number>('geocoding.fetchTimeout')!;
    this.pollInterval = this.config.get<number>('geocoding.pollInterval')!;
    this.batchSize = this.config.get<number>('geocoding.batchSize')!;
  }

  onModuleInit(): void {
    this.logger.log(`Starting geocoding poll every ${this.pollInterval}ms`);
    this.timer = setInterval(() => {
      this.poll().catch((err) =>
        this.logger.error(
          'Geocoding poll error',
          err instanceof Error ? err.stack : err,
        ),
      );
    }, this.pollInterval);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  /**
   * Ищет сенсоры без геокодированных данных (city === null)
   * и запрашивает Nominatim для каждого с rate-limit паузой.
   */
  private async poll(): Promise<void> {
    const sensors = await this.sensorRepo.findWithoutCity(this.batchSize);

    if (sensors.length === 0) return;
    this.logger.debug(`Geocoding ${sensors.length} sensor(s)`);

    for (const sensor of sensors) {
      const location = await this.reverseGeocode(
        sensor.geo.lat,
        sensor.geo.lng,
      );

      await this.sensorRepo.updateLocation(sensor._id, location);

      this.logger.debug(
        `Geocoded ${sensor.sensor_id}: ${location.city || '(empty)'}, ${location.state || '(empty)'}, ${location.country || '(empty)'}`,
      );

      await this.sleep(this.requestInterval);
    }
  }

  /**
   * Выполняет reverse geocoding через Nominatim API.
   * Возвращает city, state, country. При ошибке возвращает пустые строки,
   * чтобы не перезапрашивать.
   */
  private async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<{ city: string; state: string; country: string }> {
    const url = `${this.baseUrl}?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=en`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.fetchTimeout);

      const response = await globalThis.fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent },
      });
      clearTimeout(timer);

      if (!response.ok) {
        this.logger.warn(
          `Nominatim returned ${response.status} for (${lat}, ${lng})`,
        );
        return { city: '', state: '', country: '' };
      }

      const data = (await response.json()) as NominatimResponse;
      const address = data.address;

      if (!address) {
        return { city: '', state: '', country: '' };
      }

      return {
        city:
          address.city ||
          address.town ||
          address.village ||
          address.hamlet ||
          '',
        state:
          address.state ||
          address.county ||
          address.state_district ||
          address.region ||
          '',
        country: address.country || '',
      };
    } catch (err) {
      this.logger.warn(
        `Nominatim failed for (${lat}, ${lng}): ${err instanceof Error ? err.message : String(err)}`,
      );
      return { city: '', state: '', country: '' };
    }
  }

  /** @param ms - время ожидания в миллисекундах */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
