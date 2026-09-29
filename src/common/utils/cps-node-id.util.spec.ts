import { MAX_CPS_CHAIN_PAYLOAD_BYTES } from '../constants/cps-payload.constants.js';
import {
  createCpsAnchorSourceKey,
  createCpsChainPayloadSourceKey,
  MAX_CPS_NODE_ID,
  normalizeCpsNodeId,
} from './cps-node-id.util.js';

describe('normalizeCpsNodeId', () => {
  it('сохраняет максимальное значение u64 как decimal string', () => {
    expect(normalizeCpsNodeId(MAX_CPS_NODE_ID)).toBe('18446744073709551615');
  });

  it.each(['-1', '+1', '01', '1.5', '', ' 1'])(
    'отклоняет неканоническое значение %p',
    (value) => {
      expect(() => normalizeCpsNodeId(value)).toThrow(RangeError);
    },
  );

  it('отклоняет значение выше диапазона u64', () => {
    expect(() => normalizeCpsNodeId(MAX_CPS_NODE_ID + 1n)).toThrow(
      'CPS node id exceeds uint64 range',
    );
  });
});

describe('createCpsAnchorSourceKey', () => {
  it('строит идемпотентный ключ из числового NodeId и CID', () => {
    const cid = `b${'a'.repeat(58)}`;

    expect(createCpsAnchorSourceKey(42n, cid)).toBe(`cps:42:${cid}`);
  });

  it('отклоняет значение, которое не является CID', () => {
    expect(() => createCpsAnchorSourceKey(42n, 'not-a-cid')).toThrow(
      'CPS anchor CID is invalid',
    );
  });
});

describe('createCpsChainPayloadSourceKey', () => {
  it('строит детерминированный ключ без включения payload', () => {
    const payload = new Uint8Array([1, 2, 3]);

    const sourceKey = createCpsChainPayloadSourceKey(42n, payload);

    expect(sourceKey).toMatch(/^cps:42:chain:[0-9a-f]{64}$/);
    expect(sourceKey).toBe(createCpsChainPayloadSourceKey('42', payload));
    expect(sourceKey).not.toContain('1,2,3');
  });

  it('отклоняет пустой и превышающий chain limit payload', () => {
    expect(() => createCpsChainPayloadSourceKey(1n, new Uint8Array())).toThrow(
      'must not be empty',
    );
    expect(() =>
      createCpsChainPayloadSourceKey(
        1n,
        new Uint8Array(MAX_CPS_CHAIN_PAYLOAD_BYTES + 1),
      ),
    ).toThrow(`exceeds ${MAX_CPS_CHAIN_PAYLOAD_BYTES} bytes`);
  });

  it('принимает chain payload ровно в 8192 байта', () => {
    expect(() =>
      createCpsChainPayloadSourceKey(
        1n,
        new Uint8Array(MAX_CPS_CHAIN_PAYLOAD_BYTES),
      ),
    ).not.toThrow();
  });
});
