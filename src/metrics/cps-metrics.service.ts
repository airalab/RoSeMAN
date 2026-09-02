import { Injectable } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Counter } from 'prom-client';

export interface CompletedCpsAnchorMetrics {
  readonly rawPayloadBytes: number;
  readonly storedRecords: number;
  readonly invalidSignatures: number;
  readonly unsupportedMessages: number;
  readonly privateSections: number;
}

/** Публикует накопительные метрики canonical CPS pipeline. */
@Injectable()
export class CpsMetricsService {
  /** Создаёт сервис на основе зарегистрированных Prometheus counters. */
  constructor(
    @InjectMetric('roseman_cps_raw_payload_bytes_total')
    private readonly rawPayloadBytes: Counter<string>,
    @InjectMetric('roseman_cps_stored_records_total')
    private readonly storedRecords: Counter<string>,
    @InjectMetric('roseman_cps_invalid_signatures_total')
    private readonly invalidSignatures: Counter<string>,
    @InjectMetric('roseman_cps_unsupported_messages_total')
    private readonly unsupportedMessages: Counter<string>,
    @InjectMetric('roseman_cps_private_sections_total')
    private readonly privateSections: Counter<string>,
    @InjectMetric('roseman_cps_projection_errors_total')
    private readonly projectionErrors: Counter<string>,
  ) {}

  /**
   * Учитывает данные только окончательно завершённого anchor.
   * @param metrics - агрегаты завершённой обработки без повторов retry
   */
  recordCompletedAnchor(metrics: CompletedCpsAnchorMetrics): void {
    this.increment(this.rawPayloadBytes, metrics.rawPayloadBytes);
    this.increment(this.storedRecords, metrics.storedRecords);
    this.increment(this.invalidSignatures, metrics.invalidSignatures);
    this.increment(this.unsupportedMessages, metrics.unsupportedMessages);
    this.increment(this.privateSections, metrics.privateSections);
  }

  /**
   * Учитывает records, для которых не удалось обновить legacy-проекцию.
   * @param count - число records с ошибкой проекции
   */
  recordProjectionErrors(count: number): void {
    this.increment(this.projectionErrors, count);
  }

  /**
   * Безопасно увеличивает counter только на конечное положительное значение.
   * @param counter - целевой Prometheus counter
   * @param value - добавляемое значение
   */
  private increment(counter: Counter<string>, value: number): void {
    if (Number.isFinite(value) && value > 0) counter.inc(value);
  }
}
