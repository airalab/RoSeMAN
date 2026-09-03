import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { encodeAddress } from '@polkadot/util-crypto';
import { Types } from 'mongoose';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AllExceptionsFilter } from '../src/api/common/filters/http-exception.filter.js';
import { ConnectivityController } from '../src/api/connectivity/connectivity.controller.js';
import { ConnectivityService } from '../src/api/connectivity/connectivity.service.js';
import {
  type ConnectivityMessageRecord,
  ConnectivityRecordRepository,
} from '../src/database/repositories/connectivity-record.repository.js';

const START = '1788429600000';
const END = '1788516000000';

/** Создаёт repository record с полным SignedEnvelope для проверки JSON DTO. */
function createRecord(): ConnectivityMessageRecord {
  return {
    _id: new Types.ObjectId('68b95ae07796696240566a01'),
    sensor_id_raw: Buffer.alloc(32, 1),
    timestamp_ms: Types.Decimal128.fromString('1788429600123'),
    recorded_at: new Date('2026-09-03T10:00:00.123Z'),
    nonce: Buffer.from([3, 4]),
    message_json: {
      metadata: { owner: encodeAddress(Buffer.alloc(32, 2), 32) },
      urban: {
        public: [{ bme280: { temperature: { celsius: 22.5 } } }],
        private: [
          {
            version: 1,
            algorithm: 'xchacha20',
            from: 'Bgc=',
            nonce: 'CAk=',
            ciphertext: 'Cgs=',
          },
        ],
      },
    },
    signature: Buffer.from([5, 6]),
  };
}

describe('Connectivity API (e2e)', () => {
  let app: INestApplication<App>;
  let findMessagePage: jest.Mock;
  let findLatestMessages: jest.Mock;

  beforeEach(async () => {
    findMessagePage = jest.fn().mockResolvedValue([createRecord()]);
    findLatestMessages = jest.fn().mockResolvedValue([createRecord()]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConnectivityController],
      providers: [
        ConnectivityService,
        {
          provide: ConnectivityRecordRepository,
          useValue: { findMessagePage, findLatestMessages },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback: number) => fallback),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/v3/messages возвращает SignedEnvelope JSON', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({
        limit: '10',
        start: '1788429600000',
        end: '1788429601000',
        sensor_id: 'ab'.repeat(32),
        payload_type: 'urban',
        measurement_type: 'temperature',
      })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({
      limit: 10,
      start: new Date(1_788_429_600_000),
      end: new Date(1_788_429_601_000),
      sensorId: 'ab'.repeat(32),
      payloadType: 'urban',
      measurementType: 'temperature',
    });
    expect(response.body.result.items[0]).toEqual({
      sensorId: encodeAddress(Buffer.alloc(32, 1), 32),
      timestamp: '1788429600123',
      nonce: 'AwQ=',
      message: {
        metadata: { owner: encodeAddress(Buffer.alloc(32, 2), 32) },
        urban: {
          public: [{ bme280: { temperature: { celsius: 22.5 } } }],
          private: [
            {
              version: 1,
              algorithm: 'xchacha20',
              from: 'Bgc=',
              nonce: 'CAk=',
              ciphertext: 'Cgs=',
            },
          ],
        },
      },
      signature: 'BQY=',
    });
    expect(response.body.result.next_cursor).toBeNull();
  });

  it('GET /api/v3/messages/latest возвращает последнее сообщение каждого сенсора', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .query({
        start: START,
        end: END,
        measurement_type: 'temperature',
        limit: '1',
        cursor: 'ignored',
      })
      .expect(200);

    expect(findLatestMessages).toHaveBeenCalledWith({
      start: new Date(Number(START)),
      end: new Date(Number(END)),
      measurementType: 'temperature',
    });
    expect(response.body.result.items).toHaveLength(1);
    expect(response.body.result.items[0]).toEqual({
      sensorId: encodeAddress(Buffer.alloc(32, 1), 32),
      timestamp: '1788429600123',
      nonce: 'AwQ=',
      message: createRecord().message_json,
      signature: 'BQY=',
    });
    expect(response.body.result).not.toHaveProperty('next_cursor');
    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('не регистрирует прежний длинный маршрут', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/connectivity/messages')
      .expect(404);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('отклоняет некорректные фильтры до обращения к repository', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: '1001', start: START, end: END, sensor_id: 'ABC' })
      .expect(400);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('не передаёт удалённые transport-фильтры в repository', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({
        limit: '10',
        start: START,
        end: END,
        source_type: 'cps',
        node_id: '42',
        cid: 'bafybeigdyrzt',
      })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({
      limit: 10,
      start: new Date(Number(START)),
      end: new Date(Number(END)),
    });
  });

  it('передаёт позицию непрозрачного cursor в следующий запрос', async () => {
    const first = createRecord();
    const extra = {
      ...createRecord(),
      _id: new Types.ObjectId('68b95ae07796696240566a02'),
      recorded_at: new Date('2026-09-03T09:59:59.999Z'),
    };
    findMessagePage.mockResolvedValueOnce([first, extra]);
    const firstResponse = await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: '1', start: START, end: END })
      .expect(200);
    const cursor = firstResponse.body.result.next_cursor as string;
    expect(cursor).toHaveLength(28);

    findMessagePage.mockClear();
    findMessagePage.mockResolvedValueOnce([]);
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: '1', start: START, end: END, cursor })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({
      limit: 1,
      start: new Date(Number(START)),
      end: new Date(Number(END)),
      cursor: {
        recordedAt: first.recorded_at,
        recordId: first._id,
      },
    });
  });

  it('отклоняет обратный временной диапазон', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ start: '2000', end: '1000' })
      .expect(400);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('разрешает запрос без временного диапазона', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: '10' })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({ limit: 10 });
  });

  it('разрешает одну границу и диапазон больше 24 часов', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ start: '0', end: '86400001' })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      start: new Date(0),
      end: new Date(86_400_001),
    });

    findMessagePage.mockClear();
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ start: START })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      start: new Date(Number(START)),
    });

    findMessagePage.mockClear();
    await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ end: END })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      end: new Date(Number(END)),
    });
  });

  it('сохраняет обязательный диапазон и лимит 24 часа для latest', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .query({ start: '0', end: '86400001' })
      .expect(413);

    expect(findLatestMessages).not.toHaveBeenCalled();
  });
});
