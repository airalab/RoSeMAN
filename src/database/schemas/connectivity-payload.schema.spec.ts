import { ConnectivityPayloadSchema } from './connectivity-payload.schema.js';

describe('ConnectivityPayloadSchema', () => {
  it('обеспечивает идемпотентность payload и transport identity', () => {
    expect(ConnectivityPayloadSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ payload_key: 1 }, { unique: true, background: true }],
        [
          { source_type: 1, source_id: 1 },
          { unique: true, background: true },
        ],
      ]),
    );
  });

  it('объявляет индексы CID и очереди декодирования', () => {
    expect(ConnectivityPayloadSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ cid: 1 }, { background: true }],
        [{ decode_status: 1, fetched_at: 1 }, { background: true }],
      ]),
    );
  });
});
