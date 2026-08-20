import { CpsAnchorSchema } from './cps-anchor.schema.js';

describe('CpsAnchorSchema', () => {
  it('защищает идемпотентность уникальным индексом source_key', () => {
    expect(CpsAnchorSchema.indexes()).toContainEqual([
      { source_key: 1 },
      { unique: true, background: true },
    ]);
  });

  it('объявляет индексы очереди и истории числового NodeId', () => {
    expect(CpsAnchorSchema.indexes()).toEqual(
      expect.arrayContaining([
        [{ status: 1, available_at: 1, block: 1 }, { background: true }],
        [{ node_id: 1, block: -1 }, { background: true }],
      ]),
    );
  });
});
