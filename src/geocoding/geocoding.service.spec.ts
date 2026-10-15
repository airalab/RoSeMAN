import type { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import type { ConnectivityRecordRepository } from '../database/repositories/connectivity-record.repository.js';
import type { SensorLocationRepository } from '../database/repositories/sensor-location.repository.js';
import { GeocodingService } from './geocoding.service.js';

const location = {
  _id: new Types.ObjectId(),
  sensor_id: 'sensor-a',
  geo: { lat: 53.2, lng: 50.1 },
  source_record_key: 'cps:1:cid:0',
};

/** Создаёт сервис геокодирования и управляемые зависимости. */
function createService(): {
  readonly service: GeocodingService;
  readonly upsertCandidates: jest.Mock;
  readonly findPending: jest.Mock;
  readonly markResolved: jest.Mock;
  readonly markNotFound: jest.Mock;
} {
  const values: Record<string, string | number> = {
    'geocoding.baseUrl': 'https://nominatim.test/reverse',
    'geocoding.userAgent': 'RoSeMAN/Test',
    'geocoding.requestInterval': 0,
    'geocoding.fetchTimeout': 1000,
    'geocoding.pollInterval': 30_000,
    'geocoding.batchSize': 10,
  };
  const config = {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
  const findLatestUnprojectedSensorLocations = jest.fn().mockResolvedValue([]);
  const upsertCandidates = jest.fn().mockResolvedValue(undefined);
  const findPending = jest.fn().mockResolvedValue([]);
  const markResolved = jest.fn().mockResolvedValue(undefined);
  const markNotFound = jest.fn().mockResolvedValue(undefined);
  const service = new GeocodingService(
    config,
    {
      findLatestUnprojectedSensorLocations,
    } as unknown as ConnectivityRecordRepository,
    {
      upsertCandidates,
      findPending,
      markResolved,
      markNotFound,
    } as unknown as SensorLocationRepository,
  );

  return {
    service,
    upsertCandidates,
    findPending,
    markResolved,
    markNotFound,
  };
}

describe('GeocodingService', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('синхронизирует CPS и сохраняет полный адрес Nominatim', async () => {
    const context = createService();
    context.findPending.mockResolvedValueOnce([location]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        address: {
          city: 'Samara',
          state: 'Samara Oblast',
          country: 'Russia',
        },
      }),
    });

    await context.service.runOnce();

    expect(context.upsertCandidates).toHaveBeenCalledWith([]);
    expect(context.markResolved).toHaveBeenCalledWith(
      location,
      'Samara',
      'Samara Oblast',
      'Russia',
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://nominatim.test/reverse?lat=53.2&lon=50.1&format=json&zoom=10&accept-language=en',
      expect.objectContaining({ headers: { 'User-Agent': 'RoSeMAN/Test' } }),
    );
  });

  it.each([
    ['county', 'County Region'],
    ['state_district', 'District Region'],
    ['region', 'Generic Region'],
  ])('использует Nominatim %s как fallback региона', async (field, value) => {
    const context = createService();
    context.findPending.mockResolvedValueOnce([location]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        address: { city: 'Samara', [field]: value, country: 'Russia' },
      }),
    });

    await context.service.runOnce();

    expect(context.markResolved).toHaveBeenCalledWith(
      location,
      'Samara',
      value,
      'Russia',
    );
  });

  it('сохраняет пустой регион при полном адресе без области', async () => {
    const context = createService();
    context.findPending.mockResolvedValueOnce([location]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        address: { city: 'Samara', country: 'Russia' },
      }),
    });

    await context.service.runOnce();

    expect(context.markResolved).toHaveBeenCalledWith(
      location,
      'Samara',
      '',
      'Russia',
    );
  });

  it.each([429, 500])(
    'оставляет позицию pending при HTTP %s',
    async (status) => {
      const context = createService();
      context.findPending.mockResolvedValueOnce([location]);
      globalThis.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
      });

      await context.service.runOnce();

      expect(context.markResolved).not.toHaveBeenCalled();
      expect(context.markNotFound).not.toHaveBeenCalled();
    },
  );

  it('помечает успешный ответ без полного адреса как not_found', async () => {
    const context = createService();
    context.findPending.mockResolvedValueOnce([location]);
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ address: { country: 'Russia' } }),
    });

    await context.service.runOnce();

    expect(context.markNotFound).toHaveBeenCalledWith(location);
  });
});
