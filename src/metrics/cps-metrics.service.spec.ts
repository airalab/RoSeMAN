import type { Counter } from 'prom-client';
import { CpsMetricsService } from './cps-metrics.service.js';

interface CounterMock {
  readonly counter: Counter<string>;
  readonly increment: jest.Mock;
}

/** Создаёт минимальный mock Prometheus counter. */
function createCounter(): CounterMock {
  const increment = jest.fn();
  return {
    counter: { inc: increment } as unknown as Counter<string>,
    increment,
  };
}

describe('CpsMetricsService', () => {
  it('публикует положительные агрегаты завершённого anchor', () => {
    const rawPayloadBytes = createCounter();
    const storedRecords = createCounter();
    const invalidSignatures = createCounter();
    const unsupportedMessages = createCounter();
    const privateSections = createCounter();
    const projectionErrors = createCounter();
    const service = new CpsMetricsService(
      rawPayloadBytes.counter,
      storedRecords.counter,
      invalidSignatures.counter,
      unsupportedMessages.counter,
      privateSections.counter,
      projectionErrors.counter,
    );

    service.recordCompletedAnchor({
      rawPayloadBytes: 1024,
      storedRecords: 8,
      invalidSignatures: 2,
      unsupportedMessages: 1,
      privateSections: 3,
    });
    service.recordProjectionErrors(4);

    expect(rawPayloadBytes.increment).toHaveBeenCalledWith(1024);
    expect(storedRecords.increment).toHaveBeenCalledWith(8);
    expect(invalidSignatures.increment).toHaveBeenCalledWith(2);
    expect(unsupportedMessages.increment).toHaveBeenCalledWith(1);
    expect(privateSections.increment).toHaveBeenCalledWith(3);
    expect(projectionErrors.increment).toHaveBeenCalledWith(4);
  });

  it('не увеличивает counters нулевыми и некорректными значениями', () => {
    const counters = Array.from({ length: 6 }, () => createCounter());
    const service = new CpsMetricsService(
      counters[0].counter,
      counters[1].counter,
      counters[2].counter,
      counters[3].counter,
      counters[4].counter,
      counters[5].counter,
    );

    service.recordCompletedAnchor({
      rawPayloadBytes: 0,
      storedRecords: -1,
      invalidSignatures: Number.NaN,
      unsupportedMessages: 0,
      privateSections: 0,
    });
    service.recordProjectionErrors(0);

    for (const counter of counters) {
      expect(counter.increment).not.toHaveBeenCalled();
    }
  });
});
