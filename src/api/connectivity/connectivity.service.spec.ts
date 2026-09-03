import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { encodeAddress } from '@polkadot/util-crypto';
import { Types } from 'mongoose';
import type {
  ConnectivityMessageRecord,
  ConnectivityRecordRepository,
} from '../../database/repositories/connectivity-record.repository.js';
import { decodeConnectivityCursor } from './connectivity-cursor.js';
import { ConnectivityService } from './connectivity.service.js';
import { ConnectivityLatestMessageQueryDto } from './dto/connectivity-latest-message-query.dto.js';
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
      metadata: { owner: encodeAddress(new Uint8Array(32).fill(2), 32) },
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

/** Создаёт service и управляемый repository mock. */
function createService(records: ConnectivityMessageRecord[] = []): {
  readonly service: ConnectivityService;
  readonly findMessagePage: jest.Mock;
  readonly findLatestMessages: jest.Mock;
} {
  const findMessagePage = jest.fn().mockResolvedValue(records);
  const findLatestMessages = jest.fn().mockResolvedValue(records);
  const config = {
    get: jest.fn((_key: string, fallback: number) => fallback),
  } as unknown as ConfigService;
  return {
    service: new ConnectivityService(
      {
        findMessagePage,
        findLatestMessages,
      } as unknown as ConnectivityRecordRepository,
      config,
    ),
    findMessagePage,
    findLatestMessages,
  };
}

describe('ConnectivityService', () => {
  it('возвращает страницу SignedEnvelope JSON и cursor', async () => {
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
      measurement_type: 'temperature',
    });

    const result = await service.getMessages(query);

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
      timestamp: '1788429600123',
      nonce: 'AwQ=',
      message: {
        metadata: { owner: encodeAddress(new Uint8Array(32).fill(2), 32) },
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
      service.getMessages(
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
      owner: 'owner',
      measurement_type: 'temperature',
    });

    const result = await service.getLatestMessages(query);

    expect(findLatestMessages).toHaveBeenCalledWith({
      start: new Date(START),
      end: new Date(END),
      owner: 'owner',
      measurementType: 'temperature',
    });
    expect(result).toEqual({
      items: [
        {
          sensorId: encodeAddress(record.sensor_id_raw, 32),
          timestamp: '1788429600123',
          nonce: 'AwQ=',
          message: record.message_json,
          signature: 'BQY=',
        },
      ],
    });
    expect(result).not.toHaveProperty('next_cursor');
  });

  it('разрешает запрос без временного диапазона с limit 1000 по умолчанию', async () => {
    const { service, findMessagePage } = createService();

    await expect(
      service.getMessages(new ConnectivityMessageListQueryDto()),
    ).resolves.toEqual({ items: [], next_cursor: null });
    expect(findMessagePage).toHaveBeenCalledWith({ limit: 1000 });
  });

  it('разрешает односторонние границы и диапазон больше 24 часов', async () => {
    const { service, findMessagePage } = createService();

    await service.getMessages(
      Object.assign(new ConnectivityMessageListQueryDto(), { start: START }),
    );
    await service.getMessages(
      Object.assign(new ConnectivityMessageListQueryDto(), { end: END }),
    );
    await service.getMessages(
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
      service.getMessages(
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
      service.getLatestMessages(new ConnectivityLatestMessageQueryDto()),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.getLatestMessages(
        Object.assign(new ConnectivityLatestMessageQueryDto(), {
          start: 0,
          end: 86_400_001,
        }),
      ),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
    expect(findLatestMessages).not.toHaveBeenCalled();
  });

  it('преобразует неверный cursor в безопасную HTTP-ошибку', async () => {
    const { service, findMessagePage } = createService();

    await expect(
      service.getMessages(
        Object.assign(new ConnectivityMessageListQueryDto(), {
          start: START,
          end: END,
          cursor: Buffer.from('{}').toString('base64url'),
        }),
      ),
    ).rejects.toThrow('Invalid cursor');
    expect(findMessagePage).not.toHaveBeenCalled();
  });
});
