/**
 * Ограниченный LRU-кеш с необязательным сроком жизни записи.
 * Положительные результаты хранятся до вытеснения, отрицательные — до TTL.
 */
export class BoundedCache<V> {
  private readonly entries = new Map<
    string,
    { value: V; expiresAt: number | null }
  >();

  /**
   * @param maxEntries - предел числа записей; самая давняя вытесняется первой
   * @param now - источник времени, подменяется в тестах
   */
  constructor(
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
      throw new RangeError('BoundedCache size must be a positive integer');
    }
  }

  /** Возвращает живую запись и делает её самой свежей. */
  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /**
   * Сохраняет значение.
   * @param ttlMs - срок жизни; без него запись живёт до вытеснения
   */
  set(key: string, value: V, ttlMs?: number): void {
    this.entries.delete(key);
    this.entries.set(key, {
      value,
      expiresAt: ttlMs === undefined ? null : this.now() + ttlMs,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
