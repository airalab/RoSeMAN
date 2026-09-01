import { createHash } from 'node:crypto';
import type { Model } from 'mongoose';
import { CONNECTIVITY_SCHEMA_REVISION } from '../../common/constants/connectivity-protocol.constants.js';
import { ConnectivityPayloadDecodeStatus } from '../../common/constants/connectivity-storage.enum.js';
import { ProtocolBatchWireFormat } from '../../measurement/protocol/signed-envelope-batch-payload.decoder.js';
import type { ConnectivityPayloadDocument } from '../schemas/connectivity-payload.schema.js';
import {
  ConnectivityPayloadConflictError,
  ConnectivityPayloadRepository,
} from './connectivity-payload.repository.js';

/** Создаёт минимальный mock Mongoose-модели payload. */
function createModelMock(): { readonly updateOne: jest.Mock } {
  return { updateOne: jest.fn() };
}

/** Приводит тестовый mock к типу Mongoose-модели. */
function asModel(mock: {
  readonly updateOne: jest.Mock;
}): Model<ConnectivityPayloadDocument> {
  return mock as unknown as Model<ConnectivityPayloadDocument>;
}

describe('ConnectivityPayloadRepository', () => {
  it('сохраняет exact bytes и checksum только при первом появлении ключа', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue(undefined);
    model.updateOne.mockReturnValue({ exec });
    const repository = new ConnectivityPayloadRepository(asModel(model));
    const bytes = new Uint8Array([0, 1, 2, 255]);
    const fetchedAt = new Date('2026-09-01T08:00:00.000Z');

    await repository.upsertFetched({
      payloadKey: 'cps:1:cid',
      sourceId: 'cps:1:cid',
      nodeId: '1',
      block: 42,
      cid: 'cid',
      wireFormat: ProtocolBatchWireFormat.Xz,
      rawPayload: bytes,
      fetchedAt,
    });

    const [filter, update, options] = model.updateOne.mock.calls[0] as [
      Record<string, unknown>,
      { $setOnInsert: Record<string, unknown> },
      Record<string, unknown>,
    ];
    expect(filter).toEqual({
      payload_key: 'cps:1:cid',
      raw_size: 4,
      raw_sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(options).toEqual({ upsert: true });
    expect(update.$setOnInsert).toMatchObject({
      raw_payload: Buffer.from(bytes),
      raw_size: 4,
      raw_sha256: createHash('sha256').update(bytes).digest('hex'),
      schema_revision: CONNECTIVITY_SCHEMA_REVISION,
      decode_status: ConnectivityPayloadDecodeStatus.Pending,
      fetched_at: fetchedAt,
    });
    expect(exec).toHaveBeenCalled();
  });

  it('обновляет только состояние decode и время завершения', async () => {
    const model = createModelMock();
    const exec = jest.fn().mockResolvedValue(undefined);
    model.updateOne.mockReturnValue({ exec });
    const repository = new ConnectivityPayloadRepository(asModel(model));

    await repository.updateDecodeStatus(
      'cps:1:cid',
      ConnectivityPayloadDecodeStatus.Decoded,
    );

    const [filter, update] = model.updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      {
        $set: { decode_status: string; decoded_at: Date };
        $unset: Record<string, unknown>;
      },
    ];
    expect(filter).toEqual({ payload_key: 'cps:1:cid' });
    expect(update.$set.decode_status).toBe(
      ConnectivityPayloadDecodeStatus.Decoded,
    );
    expect(update.$set.decoded_at).toBeInstanceOf(Date);
    expect(update.$unset).toEqual({ error_code: '', error_message: '' });
  });

  it('возвращает стабильную ошибку при конфликте immutable payload bytes', async () => {
    const model = createModelMock();
    model.updateOne.mockReturnValue({
      exec: jest.fn().mockRejectedValue({ code: 11000 }),
    });
    const repository = new ConnectivityPayloadRepository(asModel(model));

    await expect(
      repository.upsertFetched({
        payloadKey: 'cps:1:cid',
        sourceId: 'cps:1:cid',
        wireFormat: ProtocolBatchWireFormat.Raw,
        rawPayload: new Uint8Array([1, 2, 3]),
      }),
    ).rejects.toMatchObject({
      name: ConnectivityPayloadConflictError.name,
      code: 'PAYLOAD_CONTENT_CONFLICT',
      payloadKey: 'cps:1:cid',
    });
  });
});
