import { fromBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import { Types } from 'mongoose';
import type {
  ConnectivityCsvRecord,
  ConnectivityMessageRecord,
  ConnectivityRecordRepository,
} from '../../database/repositories/connectivity-record.repository.js';
import type { CpsAnchorRepository } from '../../database/repositories/cps-anchor.repository.js';
import type { SensorLocationRepository } from '../../database/repositories/sensor-location.repository.js';
import { decodeConnectivityCursor } from './connectivity-cursor.js';
import { ConnectivityService } from './connectivity.service.js';
import { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
import { ConnectivityMaxMessageQueryDto } from './dto/connectivity-max-message-query.dto.js';
import { ConnectivityMessageListQueryDto } from './dto/connectivity-message-list-query.dto.js';

const START = 1_788_429_600_000;
const END = START + 86_400_000;

/** Создаёт публичную repository-запись с заданной позицией сортировки. */
function createRecord(
  recordId: string,
  recordedAt: string,
): ConnectivityMessageRecord {
  return {
    _id: new Types.ObjectId(recordId),
    sensor_id_raw: Buffer.alloc(32, 1),
    timestamp_ms: Types.Decimal128.fromString('1788429600123'),
    recorded_at: new Date(recordedAt),
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

/** Создаёт service и управляемый repository mock. */
function createService(records: ConnectivityMessageRecord[] = []): {
  readonly service: ConnectivityService;
  readonly findMessagePage: jest.Mock;
  readonly findLatestMessages: jest.Mock;
  readonly findMaxMessages: jest.Mock;
  readonly findCsvRecords: jest.Mock;
  readonly findCurrentSensorIdsByOwner: jest.Mock;
  readonly getCitiesGrouped: jest.Mock;
  readonly findSensorIdsByCity: jest.Mock;
} {
  const findMessagePage = jest.fn().mockResolvedValue(records);
  const findLatestMessages = jest.fn().mockResolvedValue(records);
  const findMaxMessages = jest.fn().mockResolvedValue(records);
  const findCsvRecords = jest.fn().mockResolvedValue([]);
  const findCurrentSensorIdsByOwner = jest.fn().mockResolvedValue([]);
  const getCitiesGrouped = jest.fn().mockResolvedValue({});
  const findSensorIdsByCity = jest.fn().mockResolvedValue([]);
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService;
  return {
    service: new ConnectivityService(
      {
        findMessagePage,
        findLatestMessages,
        findMaxMessages,
        findCsvRecords,
      } as unknown as ConnectivityRecordRepository,
      {
        findCurrentSensorIdsByOwner,
      } as unknown as CpsAnchorRepository,
      {
        getCitiesGrouped,
        findSensorIdsByCity,
      } as unknown as SensorLocationRepository,
      config,
    ),
    findMessagePage,
    findLatestMessages,
    findMaxMessages,
    findCsvRecords,
    findCurrentSensorIdsByOwner,
    getCitiesGrouped,
    findSensorIdsByCity,
  };
}

describe('ConnectivityService', () => {
  it('возвращает CPS-города по странам и регионам', async () => {
    const { service, getCitiesGrouped } = createService();
    getCitiesGrouped.mockResolvedValueOnce({
      Russia: { 'Samara Oblast': ['Samara', 'Tolyatti'] },
    });

    await expect(service.getCities()).resolves.toEqual({
      Russia: { 'Samara Oblast': ['Samara', 'Tolyatti'] },
    });
    expect(getCitiesGrouped).toHaveBeenCalledTimes(1);
  });

  it('возвращает идентификаторы сенсоров текущего владельца', async () => {
    const { service, findCurrentSensorIdsByOwner } = createService();
    findCurrentSensorIdsByOwner.mockResolvedValueOnce(['sensor-a', 'sensor-b']);

    await expect(service.getSensorIdsByOwner('5Owner')).resolves.toEqual([
      'sensor-a',
      'sensor-b',
    ]);
    expect(findCurrentSensorIdsByOwner).toHaveBeenCalledWith('5Owner');
  });

  it('формирует совместимый TSV из известных и произвольных CPS-показаний', async () => {
    const { service, findCsvRecords, findSensorIdsByCity } = createService();
    const sensorHex = '01'.repeat(32);
    const records: ConnectivityCsvRecord[] = [
      {
        sensor_id: sensorHex,
        recorded_at: new Date('2026-09-03T10:05:00.123Z'),
        message_json: {
          metadata: { nodeId: '42', timestamp: '1788429900123' },
          urban: {
            public: [
              { gps: { lat: 53.2, lon: 50.1, heightM: 81 } },
              { bme280: { temperature: { centiCelsius: 2250 } } },
              { sds011: { pm10: { deciUgM3: 123 } } },
              { custom: { voltage: { millivolts: 3300 } } },
              { custom: { vector: { x: 1, y: 2 } } },
            ],
            private: [{ secret: 10 }],
          },
        },
      },
    ];
    findSensorIdsByCity.mockResolvedValueOnce([sensorHex]);
    findCsvRecords.mockResolvedValueOnce(records);

    const csv = await service.getMessagesCsv({
      start: START,
      end: END,
      city: 'Samara',
    });

    expect(findSensorIdsByCity).toHaveBeenCalledWith('Samara');
    expect(findCsvRecords).toHaveBeenCalledWith({
      sensorIds: [sensorHex],
      start: new Date(START),
      end: new Date(END),
    });
    expect(csv).toBe(
      [
        'timestamp\tsensor_id\tgeo\tpm10\tpm25\ttemperature\tvector.x\tvector.y\tvoltage',
        `03.09.2026 10:05\t${encodeAddress(Buffer.from(sensorHex, 'hex'), 32)}\t{"lat":53.2,"lng":50.1}\t12.3\t\t22.5\t1\t2\t3300`,
      ].join('\n'),
    );
    expect(csv).not.toContain('secret');
    expect(csv).not.toContain('heightM');
  });

  it('возвращает только фиксированный заголовок для неизвестного города', async () => {
    const { service, findCsvRecords } = createService();

    await expect(
      service.getMessagesCsv({ start: START, end: END, city: 'Unknown' }),
    ).resolves.toBe('timestamp\tsensor_id\tgeo\tpm10\tpm25');
    expect(findCsvRecords).toHaveBeenCalledWith({
      sensorIds: [],
      start: new Date(START),
      end: new Date(END),
    });
  });

  it('проверяет порядок и максимальную длину CSV-диапазона', async () => {
    const { service, findCsvRecords } = createService();

    await expect(
      service.getMessagesCsv({ start: END, end: START, city: 'Samara' }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.getMessagesCsv({
        start: 0,
        end: 31 * 86_400_000 + 1,
        city: 'Samara',
      }),
    ).rejects.toThrow(PayloadTooLargeException);
    expect(findCsvRecords).not.toHaveBeenCalled();
  });

  it('возвращает страницу JSON без nonce и signature и с cursor', async () => {
    const first = createRecord(
      '68b95ae07796696240566a03',
      '2026-09-03T10:00:00.123Z',
    );
    const second = createRecord(
      '68b95ae07796696240566a02',
      '2026-09-03T10:00:00.123Z',
    );
    const extra = createRecord(
      '68b95ae07796696240566a01',
      '2026-09-03T09:59:59.999Z',
    );
    const { service, findMessagePage } = createService([first, second, extra]);
    const query = Object.assign(new ConnectivityMessageListQueryDto(), {
      limit: 2,
      start: START,
      end: END,
      sensor_id: 'ab'.repeat(32),
      type: 'temperature',
    });

    const result = await service.getMessagesJson(query);

    expect(findMessagePage).toHaveBeenCalledWith({
      limit: 2,
      start: new Date(query.start),
      end: new Date(query.end),
      sensorId: query.sensor_id,
      measurementType: 'temperature',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual({
      sensorId: encodeAddress(first.sensor_id_raw, 32),
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
    expect(result.items[0]).not.toHaveProperty('nonce');
    expect(result.items[0]).not.toHaveProperty('signature');
    expect(result.next_cursor).not.toBeNull();
    expect(decodeConnectivityCursor(result.next_cursor!)).toEqual({
      recordedAt: second.recorded_at,
      recordId: second._id,
    });
  });

  it('возвращает null cursor для последней страницы', async () => {
    const { service } = createService([
      createRecord('68b95ae07796696240566a01', '2026-09-03T10:00:00.123Z'),
    ]);

    await expect(
      service.getMessagesJson(
        Object.assign(new ConnectivityMessageListQueryDto(), {
          start: START,
          end: END,
        }),
      ),
    ).resolves.toMatchObject({ next_cursor: null });
  });

  it('возвращает последние сообщения сенсоров без pagination metadata', async () => {
    const record = createRecord(
      '68b95ae07796696240566a01',
      '2026-09-03T10:00:00.123Z',
    );
    const { service, findLatestMessages } = createService([record]);
    const query = Object.assign(new ConnectivityLatestMessageQueryDto(), {
      start: START,
      end: END,
      node_id: '42',
      type: 'temperature',
    });

    const result = await service.getLatestMessagesJson(query);

    expect(findLatestMessages).toHaveBeenCalledWith({
      start: new Date(START),
      end: new Date(END),
      nodeId: '42',
      measurementType: 'temperature',
    });
    expect(result).toEqual({
      items: [
        {
          sensorId: encodeAddress(record.sensor_id_raw, 32),
          message: record.message_json,
        },
      ],
    });
    expect(result.items[0]).not.toHaveProperty('nonce');
    expect(result.items[0]).not.toHaveProperty('signature');
    expect(result).not.toHaveProperty('next_cursor');
  });

  it('возвращает максимальные сообщения сенсоров без pagination metadata', async () => {
    const record = createRecord(
      '68b95ae07796696240566a01',
      '2026-09-03T10:00:00.123Z',
    );
    const { service, findMaxMessages } = createService([record]);
    const query = Object.assign(new ConnectivityMaxMessageQueryDto(), {
      start: START,
      end: END,
      type: 'temperature' as const,
      node_id: '42',
    });

    const result = await service.getMaxMessagesJson(query);

    expect(findMaxMessages).toHaveBeenCalledWith({
      start: new Date(START),
      end: new Date(END),
      type: 'temperature',
      nodeId: '42',
    });
    expect(result).toEqual({
      items: [
        {
          sensorId: encodeAddress(record.sensor_id_raw, 32),
          message: record.message_json,
        },
      ],
    });
    expect(result).not.toHaveProperty('next_cursor');
  });

  it('разрешает запрос без временного диапазона с limit 1000 по умолчанию', async () => {
    const { service, findMessagePage } = createService();

    await expect(
      service.getMessagesJson(new ConnectivityMessageListQueryDto()),
    ).resolves.toEqual({ items: [], next_cursor: null });
    expect(findMessagePage).toHaveBeenCalledWith({ limit: 1000 });
  });

  it('разрешает односторонние границы и диапазон больше 24 часов', async () => {
    const { service, findMessagePage } = createService();

    await service.getMessagesJson(
      Object.assign(new ConnectivityMessageListQueryDto(), { start: START }),
    );
    await service.getMessagesJson(
      Object.assign(new ConnectivityMessageListQueryDto(), { end: END }),
    );
    await service.getMessagesJson(
      Object.assign(new ConnectivityMessageListQueryDto(), {
        start: 0,
        end: 86_400_001,
      }),
    );

    expect(findMessagePage).toHaveBeenNthCalledWith(1, {
      limit: 1000,
      start: new Date(START),
    });
    expect(findMessagePage).toHaveBeenNthCalledWith(2, {
      limit: 1000,
      end: new Date(END),
    });
    expect(findMessagePage).toHaveBeenNthCalledWith(3, {
      limit: 1000,
      start: new Date(0),
      end: new Date(86_400_001),
    });
  });

  it('отклоняет обратный диапазон списка сообщений', async () => {
    const { service, findMessagePage } = createService();

    await expect(
      service.getMessagesJson(
        Object.assign(new ConnectivityMessageListQueryDto(), {
          start: 2,
          end: 1,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMessagePage).not.toHaveBeenCalled();
  });

  it('сохраняет обязательный диапазон и лимит 24 часа для latest', async () => {
    const { service, findLatestMessages } = createService();

    await expect(
      service.getLatestMessagesJson(new ConnectivityLatestMessageQueryDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getLatestMessagesJson(
        Object.assign(new ConnectivityLatestMessageQueryDto(), {
          start: 0,
          end: 86_400_001,
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(findLatestMessages).not.toHaveBeenCalled();
  });

  it('сохраняет обязательный диапазон и лимит 24 часа для max', async () => {
    const { service, findMaxMessages } = createService();

    await expect(
      service.getMaxMessagesJson(
        Object.assign(new ConnectivityMaxMessageQueryDto(), {
          type: 'pm10' as const,
        }),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getMaxMessagesJson(
        Object.assign(new ConnectivityMaxMessageQueryDto(), {
          start: 0,
          end: 86_400_001,
          type: 'pm10' as const,
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(findMaxMessages).not.toHaveBeenCalled();
  });

  it('преобразует неверный cursor в безопасную HTTP-ошибку', async () => {
    const { service, findMessagePage } = createService();

    await expect(
      service.getMessagesJson(
        Object.assign(new ConnectivityMessageListQueryDto(), {
          start: START,
          end: END,
          cursor: Buffer.from('{}').toString('base64url'),
        }),
      ),
    ).rejects.toThrow('Invalid cursor');
    expect(findMessagePage).not.toHaveBeenCalled();
  });
  it('не меняет подписанные Buffer при сборке protobuf batch', async () => {
    const record = {
      ...createRecord('68b95ae07796696240566a01', '2026-09-03T10:00:00.123Z'),
      timestamp_ms: Types.Decimal128.fromString('18446744073709551615'),
      message_raw: Buffer.from([0xa0, 0x06, 0x01, 0x0a, 0x00]),
    };
    const { service } = createService([record]);
    const result = await service.getMessagesProtobuf(
      new ConnectivityMessageListQueryDto(),
    );
    const envelope = fromBinary(SignedEnvelopeBatchSchema, result.bytes)
      .batch[0];
    expect(Buffer.from(envelope.message)).toEqual(record.message_raw);
    expect(Buffer.from(envelope.sensorId)).toEqual(record.sensor_id_raw);
    expect(Buffer.from(envelope.nonce)).toEqual(record.nonce);
    expect(Buffer.from(envelope.signature)).toEqual(record.signature);
    expect(record.message_raw).toEqual(
      Buffer.from([0xa0, 0x06, 0x01, 0x0a, 0x00]),
    );
  });

  it('сохраняет подписанные Buffer в protobuf max batch', async () => {
    const record = {
      ...createRecord('68b95ae07796696240566a01', '2026-09-03T10:00:00.123Z'),
      message_raw: Buffer.from([0xa0, 0x06, 0x01, 0x0a, 0x00]),
    };
    const { service, findMaxMessages } = createService([record]);
    const result = await service.getMaxMessagesProtobuf(
      Object.assign(new ConnectivityMaxMessageQueryDto(), {
        start: START,
        end: END,
        type: 'temperature' as const,
      }),
    );

    const envelope = fromBinary(SignedEnvelopeBatchSchema, result).batch[0];
    expect(Buffer.from(envelope.message)).toEqual(record.message_raw);
    expect(findMaxMessages).toHaveBeenCalledWith(
      expect.objectContaining({
        includeMessageRaw: true,
        type: 'temperature',
      }),
    );
  });
});
