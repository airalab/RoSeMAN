import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  cryptoWaitReady,
  ed25519PairFromSeed,
  ed25519Sign,
  encodeAddress,
} from '@polkadot/util-crypto';
import { fromBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
import {
  buildEnvelopeSigningBytes,
  Ed25519EnvelopeSignatureVerifier,
} from '../src/measurement/protocol/envelope-signature-verifier.js';
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
import { CpsAnchorRepository } from '../src/database/repositories/cps-anchor.repository.js';
import { SensorLocationRepository } from '../src/database/repositories/sensor-location.repository.js';

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
      metadata: { nodeId: '42', timestamp: '1788429600123' },
      urban: {
        public: [{ bme280: { temperature: { centiCelsius: 2250 } } }],
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

/**
 * Собирает HTTP-тело без текстового декодирования бинарных байтов.
 * @param response - HTTP-ответ Supertest
 * @param callback - обработчик готового Buffer или ошибки чтения
 * @returns ничего; результат передаётся через callback
 */
function parseBinary(
  response: request.Response,
  callback: (error: Error | null, body?: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  response.on('data', (chunk: Buffer) => chunks.push(chunk));
  response.on('end', () => callback(null, Buffer.concat(chunks)));
  response.on('error', callback);
}

describe('Connectivity API (e2e)', () => {
  let app: INestApplication<App>;
  let findMessagePage: jest.Mock;
  let findLatestMessages: jest.Mock;
  let findMaxMessages: jest.Mock;
  let findCsvRecords: jest.Mock;
  let findCurrentSensorIdsByOwner: jest.Mock;
  let getCitiesGrouped: jest.Mock;
  let findSensorIdsByCity: jest.Mock;

  beforeEach(async () => {
    findMessagePage = jest.fn().mockResolvedValue([createRecord()]);
    findLatestMessages = jest.fn().mockResolvedValue([createRecord()]);
    findMaxMessages = jest.fn().mockResolvedValue([createRecord()]);
    findCsvRecords = jest.fn().mockResolvedValue([]);
    findCurrentSensorIdsByOwner = jest.fn().mockResolvedValue([]);
    getCitiesGrouped = jest.fn().mockResolvedValue({});
    findSensorIdsByCity = jest.fn().mockResolvedValue([]);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [ConnectivityController],
      providers: [
        ConnectivityService,
        {
          provide: ConnectivityRecordRepository,
          useValue: {
            findMessagePage,
            findLatestMessages,
            findMaxMessages,
            findCsvRecords,
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((_key: string, fallback: number) => fallback),
          },
        },
        {
          provide: CpsAnchorRepository,
          useValue: { findCurrentSensorIdsByOwner },
        },
        {
          provide: SensorLocationRepository,
          useValue: { getCitiesGrouped, findSensorIdsByCity },
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

  it('GET /api/v3/sensors/:owner возвращает текущие сенсоры владельца', async () => {
    const firstSensor = Buffer.alloc(32, 1);
    const secondSensor = Buffer.alloc(32, 2);
    findCurrentSensorIdsByOwner.mockResolvedValueOnce([
      firstSensor.toString('hex'),
      secondSensor.toString('hex'),
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v3/sensors/5Owner')
      .expect(200);

    expect(findCurrentSensorIdsByOwner).toHaveBeenCalledWith('5Owner');
    expect(response.body).toEqual({
      result: [encodeAddress(firstSensor, 32), encodeAddress(secondSensor, 32)],
    });
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.link).toBeUndefined();
  });

  it('GET /api/v3/cities группирует города по странам и регионам', async () => {
    getCitiesGrouped.mockResolvedValueOnce({
      France: { 'Ile-de-France': ['Paris'] },
      Russia: {
        '': ['Moscow'],
        'Samara Oblast': ['Samara', 'Tolyatti'],
      },
    });

    const response = await request(app.getHttpServer())
      .get('/api/v3/cities')
      .expect(200);

    expect(getCitiesGrouped).toHaveBeenCalledTimes(1);
    expect(response.body).toEqual({
      result: {
        France: { 'Ile-de-France': ['Paris'] },
        Russia: {
          '': ['Moscow'],
          'Samara Oblast': ['Samara', 'Tolyatti'],
        },
      },
    });
    expect(response.headers.deprecation).toBeUndefined();
  });

  it('GET /api/v3/sensors/:owner возвращает пустой список', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/sensors/5Nobody')
      .expect(200);

    expect(findCurrentSensorIdsByOwner).toHaveBeenCalledWith('5Nobody');
    expect(response.body).toEqual({ result: [] });
  });

  it('GET /api/v3/messages/csv скачивает CPS-показания города как TSV', async () => {
    const sensorId = Buffer.alloc(32, 1);
    const sensorHex = sensorId.toString('hex');
    findSensorIdsByCity.mockResolvedValueOnce([sensorHex]);
    findCsvRecords.mockResolvedValueOnce([
      {
        sensor_id: sensorHex,
        recorded_at: new Date('2026-09-03T10:00:00.123Z'),
        message_json: {
          urban: {
            public: [
              { gps: { lat: 53.2, lon: 50.1 } },
              { bme280: { temperature: { centiCelsius: 2250 } } },
            ],
          },
        },
      },
    ]);

    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/csv')
      .query({ start: START, end: END, city: 'Samara' })
      .expect(200)
      .expect('Content-Type', 'text/csv; charset=utf-8');

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="sensors_Samara_${START}_${END}.csv"`,
    );
    expect(response.text).toBe(
      [
        'timestamp\tsensor_id\tgeo\tpm10\tpm25\ttemperature',
        `03.09.2026 10:00\t${encodeAddress(sensorId, 32)}\t{"lat":53.2,"lng":50.1}\t\t\t22.5`,
      ].join('\n'),
    );
    expect(findSensorIdsByCity).toHaveBeenCalledWith('Samara');
    expect(findCsvRecords).toHaveBeenCalledWith({
      sensorIds: [sensorHex],
      start: new Date(Number(START)),
      end: new Date(Number(END)),
    });
    expect(response.headers.deprecation).toBeUndefined();
  });

  it('GET /api/v3/messages/csv проверяет обязательные параметры и 31 день', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/csv')
      .query({ start: START, end: END })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/csv')
      .query({ start: END, end: START, city: 'Samara' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/csv')
      .query({ start: '0', end: String(31 * 86_400_000 + 1), city: 'Samara' })
      .expect(413);

    expect(findSensorIdsByCity).not.toHaveBeenCalled();
    expect(findCsvRecords).not.toHaveBeenCalled();
  });

  it('GET /api/v3/messages/csv поддерживает Unicode в имени файла', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/csv')
      .query({ start: START, end: END, city: 'Самара' })
      .expect(200);

    expect(response.headers['content-disposition']).toContain(
      "filename*=UTF-8''sensors_%D0%A1%D0%B0%D0%BC%D0%B0%D1%80%D0%B0_",
    );
  });

  it('GET /api/v3/messages/json возвращает JSON без nonce и signature', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({
        limit: '10',
        start: '1788429600000',
        end: '1788429601000',
        sensor_id: 'ab'.repeat(32),
        payload_type: 'urban',
        type: 'temperature',
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
      message: {
        metadata: { nodeId: '42', timestamp: '1788429600123' },
        urban: {
          public: [{ bme280: { temperature: { centiCelsius: 2250 } } }],
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
    });
    expect(response.body.result.items[0]).not.toHaveProperty('nonce');
    expect(response.body.result.items[0]).not.toHaveProperty('signature');
    expect(response.body.result.next_cursor).toBeNull();
    expect(response.headers.deprecation).toBeUndefined();
    expect(response.headers.link).toBeUndefined();
  });

  it('принимает sensor_id в SS58 и передаёт в repository как lowercase hex', async () => {
    const sensorId = Buffer.alloc(32, 0xab);

    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ sensor_id: encodeAddress(sensorId, 42) })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({
      limit: 1000,
      sensorId: sensorId.toString('hex'),
    });
  });

  it('GET /api/v3/messages/latest/json возвращает последнее сообщение каждого сенсора', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/latest/json')
      .query({
        start: START,
        end: END,
        type: 'temperature',
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
      message: createRecord().message_json,
    });
    expect(response.body.result.items[0]).not.toHaveProperty('nonce');
    expect(response.body.result.items[0]).not.toHaveProperty('signature');
    expect(response.body.result).not.toHaveProperty('next_cursor');
    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('GET /api/v3/messages/max/json возвращает максимальное сообщение каждого сенсора', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages/max/json')
      .query({
        start: START,
        end: END,
        type: 'futureMetric',
        node_id: '42',
        limit: '1',
        cursor: 'ignored',
      })
      .expect(200);

    expect(findMaxMessages).toHaveBeenCalledWith({
      start: new Date(Number(START)),
      end: new Date(Number(END)),
      type: 'futureMetric',
      nodeId: '42',
    });
    expect(response.body.result).toEqual({
      items: [
        {
          sensorId: encodeAddress(Buffer.alloc(32, 1), 32),
          message: createRecord().message_json,
        },
      ],
    });
    expect(response.body.result).not.toHaveProperty('next_cursor');
    expect(findMessagePage).not.toHaveBeenCalled();
    expect(findLatestMessages).not.toHaveBeenCalled();
  });

  it('не регистрирует прежний длинный маршрут', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/connectivity/messages')
      .expect(404);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it.each([
    '/api/v3/messages/protobuf',
    '/api/v3/messages/latest/protobuf',
    '/api/v3/messages/max/protobuf',
  ])('не регистрирует прежний protobuf-маршрут %s', async (path) => {
    await request(app.getHttpServer()).get(path).expect(404);

    expect(findMessagePage).not.toHaveBeenCalled();
    expect(findLatestMessages).not.toHaveBeenCalled();
    expect(findMaxMessages).not.toHaveBeenCalled();
  });

  it('отклоняет некорректные фильтры до обращения к repository', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ limit: '1001', start: START, end: END, sensor_id: 'ABC' })
      .expect(400);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('передаёт node_id и отбрасывает внутренние transport-фильтры', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
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
      nodeId: '42',
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
      .get('/api/v3/messages/json')
      .query({ limit: '1', start: START, end: END })
      .expect(200);
    const cursor = firstResponse.body.result.next_cursor as string;
    expect(cursor).toHaveLength(28);

    findMessagePage.mockClear();
    findMessagePage.mockResolvedValueOnce([]);
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
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
      .get('/api/v3/messages/json')
      .query({ start: '2000', end: '1000' })
      .expect(400);

    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('разрешает запрос без временного диапазона', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ limit: '10' })
      .expect(200);

    expect(findMessagePage).toHaveBeenCalledWith({ limit: 10 });
  });

  it('разрешает одну границу и диапазон больше 24 часов', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ start: '0', end: '86400001' })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      start: new Date(0),
      end: new Date(86_400_001),
    });

    findMessagePage.mockClear();
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ start: START })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      start: new Date(Number(START)),
    });

    findMessagePage.mockClear();
    await request(app.getHttpServer())
      .get('/api/v3/messages/json')
      .query({ end: END })
      .expect(200);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1000,
      end: new Date(Number(END)),
    });
  });

  it('сохраняет обязательный диапазон и лимит 24 часа для latest', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest/json')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest/json')
      .query({ start: START, end: END, type: 'Temperature' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest/json')
      .query({ start: '0', end: '86400001' })
      .expect(413);

    expect(findLatestMessages).not.toHaveBeenCalled();
  });

  it('требует непустой type, но принимает неизвестное имя измерения', async () => {
    await request(app.getHttpServer())
      .get('/api/v3/messages/max/json')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/max/json')
      .query({ start: START, end: END, type: '' })
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/max/json')
      .query({ start: '0', end: '86400001', type: 'pm10' })
      .expect(413);
    expect(findMaxMessages).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .get('/api/v3/messages/max/json')
      .query({ start: START, end: END, type: 'futureMetric' })
      .expect(200);

    expect(findMaxMessages).toHaveBeenCalledWith({
      start: new Date(Number(START)),
      end: new Date(Number(END)),
      type: 'futureMetric',
    });
  });

  it.each([
    '/api/v3/messages',
    '/api/v3/messages/latest',
    '/api/v3/messages/max',
  ])(
    '%s сохраняет исходные байты и проверяемую Ed25519-подпись',
    async (path) => {
      await cryptoWaitReady();
      const pair = ed25519PairFromSeed(new Uint8Array(32).fill(7));
      // Неизвестные поля и нестандартный порядок полей должны остаться побайтно неизменными.
      const envelope = {
        sensorId: pair.publicKey,
        nonce: new Uint8Array(16).fill(0xff),
        message: new Uint8Array([0xa0, 0x06, 0x01, 0x0a, 0x00]),
      };
      const signature = ed25519Sign(buildEnvelopeSigningBytes(envelope), pair);
      const record = {
        ...createRecord(),
        sensor_id_raw: Buffer.from(envelope.sensorId),
        nonce: Buffer.from(envelope.nonce),
        message_raw: Buffer.from(envelope.message),
        signature: Buffer.from(signature),
      };
      findMessagePage.mockResolvedValue([record]);
      findLatestMessages.mockResolvedValue([record]);
      findMaxMessages.mockResolvedValue([record]);
      const response = await request(app.getHttpServer())
        .get(path)
        .query({
          start: START,
          end: END,
          sensor_id: 'ab'.repeat(32),
          node_id: '42',
          payload_type: 'urban',
          type: 'temperature',
        })
        .buffer(true)
        .parse(parseBinary)
        .expect(200)
        .expect('Content-Type', 'application/protobuf');
      const decoded = fromBinary(
        SignedEnvelopeBatchSchema,
        response.body as Buffer,
      );
      expect(decoded.batch).toHaveLength(1);
      expect(decoded.batch[0]).toMatchObject({ ...envelope, signature });
      expect(
        await new Ed25519EnvelopeSignatureVerifier().verify({
          ...decoded.batch[0],
          envelopeIndex: 0,
        }),
      ).toMatchObject({ verified: true });
      const repositoryMethod = path.endsWith('/latest')
        ? findLatestMessages
        : path.endsWith('/max')
          ? findMaxMessages
          : findMessagePage;
      expect(repositoryMethod).toHaveBeenCalledWith(
        expect.objectContaining({
          includeMessageRaw: true,
          start: new Date(Number(START)),
          end: new Date(Number(END)),
          sensorId: 'ab'.repeat(32),
          nodeId: '42',
          payloadType: 'urban',
          ...(path.endsWith('/max')
            ? { type: 'temperature' }
            : { measurementType: 'temperature' }),
        }),
      );
      const repositoryQuery = repositoryMethod.mock.calls.at(-1)?.[0];
      if (path.endsWith('/max')) {
        expect(repositoryQuery).not.toHaveProperty('measurementType');
      }
      if (path.endsWith('/latest')) {
        expect(repositoryQuery).not.toHaveProperty('type');
      }
      expect(response.headers['x-next-cursor']).toBeUndefined();
    },
  );

  it('выдаёт доступный браузеру cursor и пустой batch на последней странице', async () => {
    const first = { ...createRecord(), message_raw: Buffer.from([10, 0]) };
    findMessagePage.mockResolvedValueOnce([first, first]);
    const response = await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: 1 })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(
      fromBinary(SignedEnvelopeBatchSchema, response.body as Buffer).batch,
    ).toHaveLength(1);
    expect(response.headers['access-control-expose-headers']).toBe(
      'X-Next-Cursor',
    );
    const cursor = response.headers['x-next-cursor'] as string;
    expect(cursor).toHaveLength(28);
    findMessagePage.mockResolvedValueOnce([]);
    const last = await request(app.getHttpServer())
      .get('/api/v3/messages')
      .query({ limit: 1, cursor })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(last.headers['x-next-cursor']).toBeUndefined();
    expect(last.body).toEqual(Buffer.alloc(0));
    expect(
      fromBinary(SignedEnvelopeBatchSchema, last.body as Buffer).batch,
    ).toEqual([]);
    expect(findMessagePage).toHaveBeenLastCalledWith({
      limit: 1,
      includeMessageRaw: true,
      cursor: { recordedAt: first.recorded_at, recordId: first._id },
    });
  });

  it('возвращает пустой latest batch и сохраняет ошибки в JSON', async () => {
    findLatestMessages.mockResolvedValueOnce([]);
    const empty = await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .query({ start: START, end: END })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);
    expect(empty.body).toEqual(Buffer.alloc(0));
    findLatestMessages.mockClear();
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/v3/messages/latest')
      .query({ start: 0, end: 86400001 })
      .expect(413);
    for (const query of [
      { cursor: 'invalid' },
      { limit: 1001 },
      { start: 2, end: 1 },
      { sensor_id: 'invalid' },
    ]) {
      await request(app.getHttpServer())
        .get('/api/v3/messages')
        .query(query)
        .expect(400)
        .expect('Content-Type', /application\/json/);
    }
    expect(findMessagePage).not.toHaveBeenCalled();
    expect(findLatestMessages).not.toHaveBeenCalled();
  });

  it('возвращает пустой max batch', async () => {
    findMaxMessages.mockResolvedValueOnce([]);

    const empty = await request(app.getHttpServer())
      .get('/api/v3/messages/max')
      .query({ start: START, end: END, type: 'pm10' })
      .buffer(true)
      .parse(parseBinary)
      .expect(200);

    expect(empty.body).toEqual(Buffer.alloc(0));
    expect(
      fromBinary(SignedEnvelopeBatchSchema, empty.body as Buffer).batch,
    ).toEqual([]);
  });

  it.each([
    '/api/v3/messages',
    '/api/v3/messages/latest',
    '/api/v3/messages/max',
  ])('%s не восстанавливает отсутствующие байты из JSON', async (path) => {
    await request(app.getHttpServer())
      .get(path)
      .query({ start: START, end: END, type: 'temperature' })
      .expect(500)
      .expect('Content-Type', /application\/json/);
  });
});
