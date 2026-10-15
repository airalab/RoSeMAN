import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ConnectivityRecordRepository } from '../database/repositories/connectivity-record.repository.js';
import {
  type PendingSensorLocation,
  SensorLocationRepository,
} from '../database/repositories/sensor-location.repository.js';

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

type ReverseGeocodeResult =
  | {
      readonly status: 'resolved';
      readonly city: string;
      readonly region: string;
      readonly country: string;
    }
  | { readonly status: 'not_found' }
  | { readonly status: 'retry' };

/**
 * Синхронизирует актуальные GPS-позиции из CPS и обогащает их через
 * Nominatim reverse geocoding API.
 */
@Injectable()
export class GeocodingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GeocodingService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  private readonly baseUrl: string;
  private readonly userAgent: string;
  private readonly requestInterval: number;
  private readonly fetchTimeout: number;
  private readonly pollInterval: number;
  private readonly batchSize: number;

  /**
   * Создаёт CPS-геокодер с проверенной конфигурацией.
   * @param config - конфигурация приложения
   * @param connectivityRecordRepo - репозиторий канонических CPS-записей
   * @param sensorLocationRepo - репозиторий актуальных локаций сенсоров
   */
  constructor(
    private readonly config: ConfigService,
    private readonly connectivityRecordRepo: ConnectivityRecordRepository,
    private readonly sensorLocationRepo: SensorLocationRepository,
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

  /** Запускает немедленную синхронизацию и последующий периодический poll. */
  onModuleInit(): void {
    this.logger.log(
      `Starting CPS sensor geocoding poll every ${this.pollInterval}ms`,
    );
    void this.runOnce().catch((error: unknown) => this.logPollError(error));
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => this.logPollError(error));
    }, this.pollInterval);
  }

  /** Останавливает периодический poll при завершении приложения. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Один раз синхронизирует CPS-позиции и геокодирует ожидающий пакет.
   * Пересекающийся запуск безопасно пропускается.
   */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const candidates =
        await this.connectivityRecordRepo.findLatestUnprojectedSensorLocations(
          this.batchSize,
        );
      await this.sensorLocationRepo.upsertCandidates(candidates);

      const pending = await this.sensorLocationRepo.findPending(this.batchSize);
      if (pending.length === 0) return;
      this.logger.debug(`Geocoding ${pending.length} CPS sensor(s)`);

      for (const [index, location] of pending.entries()) {
        await this.geocodeLocation(location);
        if (index < pending.length - 1) {
          await this.sleep(this.requestInterval);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /**
   * Геокодирует одну актуальную позицию и сохраняет терминальный результат.
   * Временные ошибки оставляет для следующего poll.
   * @param location - ожидающая геокодирования позиция
   */
  private async geocodeLocation(
    location: PendingSensorLocation,
  ): Promise<void> {
    const result = await this.reverseGeocode(
      location.geo.lat,
      location.geo.lng,
    );
    if (result.status === 'retry') return;
    if (result.status === 'not_found') {
      await this.sensorLocationRepo.markNotFound(location);
      return;
    }

    await this.sensorLocationRepo.markResolved(
      location,
      result.city,
      result.region,
      result.country,
    );
    this.logger.debug(
      `Geocoded ${location.sensor_id}: ${result.city}, ${result.region || '(empty region)'}, ${result.country}`,
    );
  }

  /**
   * Выполняет reverse geocoding через Nominatim API.
   * @param lat - широта WGS84
   * @param lng - долгота WGS84
   * @returns полный адрес, терминальное отсутствие адреса или retry
   */
  private async reverseGeocode(
    lat: number,
    lng: number,
  ): Promise<ReverseGeocodeResult> {
    const url = `${this.baseUrl}?lat=${lat}&lon=${lng}&format=json&zoom=10&accept-language=en`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.fetchTimeout);

    try {
      const response = await globalThis.fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': this.userAgent },
      });

      if (!response.ok) {
        this.logger.warn(
          `Nominatim returned ${response.status} for (${lat}, ${lng})`,
        );
        return response.status === 429 || response.status >= 500
          ? { status: 'retry' }
          : { status: 'not_found' };
      }

      const data = (await response.json()) as NominatimResponse;
      const address = data.address;
      const city =
        address?.city ||
        address?.town ||
        address?.village ||
        address?.hamlet ||
        '';
      const country = address?.country || '';
      const region =
        address?.state ||
        address?.county ||
        address?.state_district ||
        address?.region ||
        '';
      if (!city || !country) return { status: 'not_found' };
      return { status: 'resolved', city, region, country };
    } catch (error) {
      this.logger.warn(
        `Nominatim failed for (${lat}, ${lng}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { status: 'retry' };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ожидает заданный интервал между запросами.
   * @param ms - время ожидания в миллисекундах
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** Записывает ошибку фонового цикла без остановки следующих запусков. */
  private logPollError(error: unknown): void {
    this.logger.error(
      'CPS sensor geocoding poll error',
      error instanceof Error ? error.stack : String(error),
    );
  }
}
