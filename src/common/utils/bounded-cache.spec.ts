import { BoundedCache } from './bounded-cache.js';

describe('BoundedCache', () => {
  it('вытесняет самую давнюю запись сверх предела', () => {
    const cache = new BoundedCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    cache.set('c', 3);

    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('запись с TTL истекает, без TTL — живёт', () => {
    let now = 0;
    const cache = new BoundedCache<string>(10, () => now);
    cache.set('negative', 'x', 1_000);
    cache.set('positive', 'y');

    now = 999;
    expect(cache.get('negative')).toBe('x');
    now = 1_000;
    expect(cache.get('negative')).toBeUndefined();
    expect(cache.get('positive')).toBe('y');
  });
});
