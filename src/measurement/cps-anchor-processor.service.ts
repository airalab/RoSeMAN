import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CpsAnchorStatus } from '../common/constants/cps-anchor-status.enum.js';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import { SensorRepository } from '../database/repositories/sensor.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { Ed25519EnvelopeSignatureVerifier } from './protocol/envelope-signature-verifier.js';
import {
  ProtocolBatchWireFormat,
  SignedEnvelopeBatchPayloadDecoder,
} from './protocol/signed-envelope-batch-payload.decoder.js';
import { SignedEnvelopeMessageDecoder } from './protocol/signed-envelope-message.decoder.js';
import { ProtocolBatchDecodeError } from './protocol/signed-envelope.types.js';

/** Забирает CPS anchors из очереди, проверяет batch и сохраняет измерения. */
@Injectable()
export class CpsAnchorProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CpsAnchorProcessorService.name);
  private readonly enabled: boolean;
  private readonly pollInterval: number;
  private readonly leaseDuration: number;
  private readonly maxAnchorsPerPoll: number;
  private readonly maxAttempts: number;
  private readonly retryBaseDelay: number;
  private readonly wireFormat: ProtocolBatchWireFormat;
  private readonly batchDecoder: SignedEnvelopeBatchPayloadDecoder;
  private readonly signatureVerifier = new Ed25519EnvelopeSignatureVerifier();
  private readonly messageDecoder = new SignedEnvelopeMessageDecoder();
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;

  /** Создаёт CPS processor и фиксирует проверенную конфигурацию запуска. */
  constructor(
    config: ConfigService,
    private readonly ipfsFetcher: IpfsFetcherService,
    private readonly cpsAnchorRepo: CpsAnchorRepository,
    private readonly measurementRepo: MeasurementRepository,
    private readonly sensorRepo: SensorRepository,
    private readonly transformer: CpsMeasurementTransformer,
  ) {
    this.enabled = config.get<boolean>('cps.enabled', false);
    this.pollInterval = config.get<number>('cps.pollInterval', 10_000);
    this.leaseDuration = config.get<number>('cps.leaseDuration', 60_000);
    this.maxAnchorsPerPoll = config.get<number>('cps.maxAnchorsPerPoll', 10);
    this.maxAttempts = config.get<number>('cps.maxAttempts', 5);
    this.retryBaseDelay = config.get<number>('cps.retryBaseDelay', 15_000);
    this.wireFormat = config.get<ProtocolBatchWireFormat>(
      'cps.batchWireFormat',
      ProtocolBatchWireFormat.Xz,
    );
    this.batchDecoder = new SignedEnvelopeBatchPayloadDecoder({
      maxCompressedBytes: config.get<number>('cps.maxCompressedBytes'),
      maxDecompressedBytes: config.get<number>('cps.maxDecompressedBytes'),
      maxXzMemoryBytes: config.get<number>('cps.maxXzMemoryBytes'),
      maxEnvelopeCount: config.get<number>('cps.maxEnvelopeCount'),
    });
  }

  /** Запускает немедленную обработку и последующий периодический poll. */
  onModuleInit(): void {
    if (!this.enabled) return;
    this.logger.log(`Starting CPS poll every ${this.pollInterval}ms`);
    void this.runOnce().catch((error: unknown) => this.logPollError(error));
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => this.logPollError(error));
    }, this.pollInterval);
  }

  /** Останавливает периодический poll при завершении приложения. */
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Обрабатывает ограниченное число доступных anchors без параллельного повторного poll.
   * @returns число захваченных anchors
   */
  async runOnce(): Promise<number> {
    if (!this.enabled || this.polling) return 0;
    this.polling = true;
    let claimed = 0;
    try {
      while (claimed < this.maxAnchorsPerPoll) {
        const anchor = await this.cpsAnchorRepo.claimNext(
          new Date(),
          this.leaseDuration,
        );
        if (!anchor) break;
        claimed += 1;
        await this.processAnchor(anchor);
      }
      return claimed;
    } finally {
      this.polling = false;
    }
  }

  /** Загружает и полностью обрабатывает один захваченный anchor. */
  private async processAnchor(anchor: CpsAnchorDocument): Promise<void> {
    try {
      const bytes = await this.ipfsFetcher.fetchBytes(anchor.cid);
      const batch = await this.batchDecoder.decode(bytes, this.wireFormat);
      let invalidEnvelopeCount = batch.errors.length;
      const measurements: Measurement[] = [];

      for (const envelope of batch.envelopes) {
        const verification = await this.signatureVerifier.verify(envelope);
        if (!verification.verified) {
          invalidEnvelopeCount += 1;
          continue;
        }

        try {
          const message = this.messageDecoder.decode(verification.envelope);
          const transformed = this.transformer.transform(
            verification.envelope,
            message,
            anchor.source_key,
          );
          if (!transformed.transformed) {
            invalidEnvelopeCount += 1;
            this.logger.debug(
              `CPS anchor ${anchor.source_key}: envelope ${envelope.envelopeIndex} rejected (${transformed.code})`,
            );
            continue;
          }
          measurements.push(transformed.measurement);
        } catch {
          invalidEnvelopeCount += 1;
        }
      }

      if (measurements.length > 0) {
        await this.measurementRepo.upsertMany(measurements);
        await this.upsertSensors(measurements);
      }

      const status =
        invalidEnvelopeCount === 0
          ? CpsAnchorStatus.PROCESSED
          : CpsAnchorStatus.PROCESSED_WITH_ERRORS;
      await this.cpsAnchorRepo.updateStatus(anchor.source_key, status, {
        validEnvelopeCount: measurements.length,
        invalidEnvelopeCount,
      });
      this.logger.debug(
        `CPS anchor ${anchor.source_key}: saved ${measurements.length}, rejected ${invalidEnvelopeCount}`,
      );
    } catch (error) {
      if (error instanceof ProtocolBatchDecodeError) {
        await this.cpsAnchorRepo.updateStatus(
          anchor.source_key,
          CpsAnchorStatus.ERROR,
          {
            errorCode: error.code,
            errorMessage: error.message,
          },
        );
        return;
      }
      await this.scheduleRetryOrFail(anchor, error);
    }
  }

  /** Дедуплицирует координаты сенсоров перед массовым upsert. */
  private async upsertSensors(measurements: Measurement[]): Promise<void> {
    const unique = new Map<string, { lat: number; lng: number }>();
    for (const measurement of measurements) {
      unique.set(measurement.sensor_id, measurement.geo);
    }
    await this.sensorRepo.bulkUpsert([...unique]);
  }

  /** Планирует экспоненциальный retry либо завершает исчерпавший попытки anchor. */
  private async scheduleRetryOrFail(
    anchor: CpsAnchorDocument,
    error: unknown,
  ): Promise<void> {
    const exhausted = anchor.attempt_count >= this.maxAttempts;
    const status = exhausted
      ? CpsAnchorStatus.ERROR
      : CpsAnchorStatus.RETRY_PENDING;
    const message =
      error instanceof Error
        ? error.message.slice(0, 500)
        : String(error).slice(0, 500);
    const exponent = Math.min(Math.max(anchor.attempt_count - 1, 0), 20);
    const availableAt = exhausted
      ? undefined
      : new Date(Date.now() + this.retryBaseDelay * 2 ** exponent);
    await this.cpsAnchorRepo.updateStatus(anchor.source_key, status, {
      errorCode: exhausted ? 'MAX_ATTEMPTS_EXCEEDED' : 'TRANSIENT_ERROR',
      errorMessage: message,
      availableAt,
    });
  }

  /** Записывает ошибку фонового poll без содержимого обрабатываемого payload. */
  private logPollError(error: unknown): void {
    this.logger.error(
      'CPS poll error',
      error instanceof Error ? error.stack : String(error),
    );
  }
}
