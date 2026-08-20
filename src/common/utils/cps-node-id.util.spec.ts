import {
  createCpsAnchorSourceKey,
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
