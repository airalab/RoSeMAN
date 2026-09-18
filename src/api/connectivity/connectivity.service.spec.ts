import { fromBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';
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
      measurement_type: 'temperature',
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
      measurement_type: 'temperature',
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
});
