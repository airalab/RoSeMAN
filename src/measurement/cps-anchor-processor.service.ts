import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CpsAnchorStatus } from '../common/constants/cps-anchor-status.enum.js';
import { CpsAnchorErrorCode } from '../common/constants/cps-anchor-error-code.enum.js';
import {
  ConnectivityLegacyProjectionStatus,
  ConnectivityPayloadDecodeStatus,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
} from '../common/constants/connectivity-storage.enum.js';
import { ConnectivityPayloadRepository } from '../database/repositories/connectivity-payload.repository.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from '../database/repositories/connectivity-record.repository.js';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import { MeasurementRepository } from '../database/repositories/measurement.repository.js';
import { SensorRepository } from '../database/repositories/sensor.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { ConnectivityRecordMapper } from './connectivity-record.mapper.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { Ed25519EnvelopeSignatureVerifier } from './protocol/envelope-signature-verifier.js';
import {
  ProtocolBatchWireFormat,
  SignedEnvelopeBatchPayloadDecoder,
} from './protocol/signed-envelope-batch-payload.decoder.js';
import {
  ProtocolMessageDecodeError,
  SignedEnvelopeMessageDecoder,
} from './protocol/signed-envelope-message.decoder.js';
import { ProtocolBatchDecodeError } from './protocol/signed-envelope.types.js';

/** Забирает CPS anchors из очереди, проверяет batch и сохраняет измерения. */
@Injectable()
export class CpsAnchorProcessorService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(CpsAnchorProcessorService.name);
  private readonly enabled: boolean;
  private readonly canonicalStorageEnabled: boolean;
  private readonly rawPayloadStorageEnabled: boolean;
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
    private readonly connectivityPayloadRepo: ConnectivityPayloadRepository,
    private readonly connectivityRecordRepo: ConnectivityRecordRepository,
    private readonly measurementRepo: MeasurementRepository,
    private readonly sensorRepo: SensorRepository,
    private readonly transformer: CpsMeasurementTransformer,
    private readonly connectivityRecordMapper: ConnectivityRecordMapper,
  ) {
    this.enabled = config.get<boolean>('cps.enabled', false);
    this.canonicalStorageEnabled = config.get<boolean>(
      'cps.canonicalStorageEnabled',
      false,
    );
    this.rawPayloadStorageEnabled = config.get<boolean>(
      'cps.rawPayloadStorageEnabled',
      false,
    );
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
      if (this.rawPayloadStorageEnabled) {
        await this.connectivityPayloadRepo.upsertFetched({
          payloadKey: anchor.source_key,
          sourceId: anchor.source_key,
          nodeId: anchor.node_id,
          block: anchor.block,
          cid: anchor.cid,
          wireFormat: this.wireFormat,
          rawPayload: bytes,
        });
      }

      let batch;
      try {
        batch = await this.batchDecoder.decode(bytes, this.wireFormat);
      } catch (error) {
        if (
          error instanceof ProtocolBatchDecodeError &&
          this.rawPayloadStorageEnabled
        ) {
          await this.connectivityPayloadRepo.updateDecodeStatus(
            anchor.source_key,
            ConnectivityPayloadDecodeStatus.Error,
            { code: error.code, message: error.message },
          );
        }
        throw error;
      }

      let invalidEnvelopeCount = batch.errors.length;
      const structuralErrors = new Map<number, string[]>();
      for (const error of batch.errors) {
        const codes = structuralErrors.get(error.envelopeIndex) ?? [];
        codes.push(error.code);
        structuralErrors.set(error.envelopeIndex, codes);
      }
      const envelopeCount = batch.envelopes.length + structuralErrors.size;
      let storedRecordCount = 0;
      let validSignatureCount = 0;
      let invalidSignatureCount = 0;
      let decodedCount = 0;
      let unsupportedCount = 0;
      let privateSectionCount = 0;
      const measurements: Measurement[] = [];
      const projectedRecords: Array<{
        record: ConnectivityRecordInput;
        measurement: Measurement;
      }> = [];

      if (this.canonicalStorageEnabled) {
        for (const [envelopeIndex, codes] of structuralErrors) {
          await this.connectivityRecordRepo.upsertRecord(
            this.connectivityRecordMapper.createInvalidEnvelopeRecord(
              anchor,
              envelopeIndex,
              codes.join(','),
            ),
          );
          storedRecordCount += 1;
        }
      }

      for (const envelope of batch.envelopes) {
        let record = this.canonicalStorageEnabled
          ? this.connectivityRecordMapper.createEnvelopeRecord(anchor, envelope)
          : undefined;
        if (record) {
          await this.connectivityRecordRepo.upsertRecord(record);
          storedRecordCount += 1;
        }

        const verification = await this.signatureVerifier.verify(envelope);
        if (!verification.verified) {
          invalidEnvelopeCount += 1;
          invalidSignatureCount += 1;
          if (record) {
            record = {
              ...record,
              signature_status: ConnectivitySignatureStatus.Invalid,
              decode_status: ConnectivityRecordDecodeStatus.NotAttempted,
              error_code: verification.reason,
              legacy_projection_status:
                ConnectivityLegacyProjectionStatus.NotAttempted,
            };
            await this.connectivityRecordRepo.upsertRecord(record);
          }
          continue;
        }
        validSignatureCount += 1;

        try {
          const message = this.messageDecoder.decode(verification.envelope);
          if (
            message.payload.case === 'urban' ||
            message.payload.case === 'insight'
          ) {
            decodedCount += 1;
            privateSectionCount += message.payload.value.private.length;
          } else {
            unsupportedCount += 1;
          }
          if (record) {
            record = this.connectivityRecordMapper.applyDecodedMessage(
              record,
              message,
            );
            await this.connectivityRecordRepo.upsertRecord(record);
          }
          const transformed = this.transformer.transform(
            verification.envelope,
            message,
            anchor.source_key,
          );
          if (!transformed.transformed) {
            invalidEnvelopeCount += 1;
            if (record) {
              record = {
                ...record,
                legacy_projection_status:
                  ConnectivityLegacyProjectionStatus.Skipped,
                projection_error_code: transformed.code,
              };
              await this.connectivityRecordRepo.upsertRecord(record);
            }
            this.logger.debug(
              `CPS anchor ${anchor.source_key}: envelope ${envelope.envelopeIndex} rejected (${transformed.code})`,
            );
            continue;
          }
          measurements.push(transformed.measurement);
          if (record) {
            projectedRecords.push({
              record,
              measurement: transformed.measurement,
            });
          }
        } catch (error) {
          if (!(error instanceof ProtocolMessageDecodeError)) throw error;
          invalidEnvelopeCount += 1;
          if (record) {
            record = {
              ...record,
              signature_status: ConnectivitySignatureStatus.Valid,
              decode_status: ConnectivityRecordDecodeStatus.Error,
              error_code: 'MALFORMED_MESSAGE',
              legacy_projection_status:
                ConnectivityLegacyProjectionStatus.NotAttempted,
            };
            await this.connectivityRecordRepo.upsertRecord(record);
          }
        }
      }

      try {
        if (measurements.length > 0) {
          await this.measurementRepo.upsertMany(measurements);
          await this.upsertSensors(measurements);
        }
      } catch (error) {
        for (const { record } of projectedRecords) {
          await this.connectivityRecordRepo.upsertRecord({
            ...record,
            legacy_projection_status: ConnectivityLegacyProjectionStatus.Error,
            projection_error_code: 'LEGACY_PROJECTION_FAILED',
          });
        }
        throw error;
      }

      for (const { record, measurement } of projectedRecords) {
        await this.connectivityRecordRepo.upsertRecord({
          ...record,
          legacy_projection_status:
            ConnectivityLegacyProjectionStatus.Projected,
          legacy_measurement_key: `${measurement.sensor_id}:${measurement.timestamp}`,
        });
      }

      if (this.rawPayloadStorageEnabled) {
        await this.connectivityPayloadRepo.updateDecodeStatus(
          anchor.source_key,
          invalidEnvelopeCount === 0
            ? ConnectivityPayloadDecodeStatus.Decoded
            : ConnectivityPayloadDecodeStatus.DecodedWithErrors,
        );
      }

      const status =
        invalidEnvelopeCount === 0
          ? CpsAnchorStatus.PROCESSED
          : CpsAnchorStatus.PROCESSED_WITH_ERRORS;
      await this.cpsAnchorRepo.updateStatus(anchor.source_key, status, {
        validEnvelopeCount: measurements.length,
        invalidEnvelopeCount,
        envelopeCount,
        storedRecordCount,
        validSignatureCount,
        invalidSignatureCount,
        decodedCount,
        unsupportedCount,
        legacyProjectionCount: measurements.length,
        privateSectionCount,
        ...(invalidEnvelopeCount > 0
          ? { errorCode: CpsAnchorErrorCode.EnvelopeErrors }
          : {}),
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

  /** Дедуплицирует доступные координаты сенсоров перед массовым upsert. */
  private async upsertSensors(measurements: Measurement[]): Promise<void> {
    const unique = new Map<string, { lat: number; lng: number }>();
    for (const measurement of measurements) {
      if (!measurement.geo) continue;
      unique.set(measurement.sensor_id, measurement.geo);
    }
    if (unique.size > 0) {
      await this.sensorRepo.bulkUpsert([...unique]);
    }
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
      errorCode: exhausted
        ? CpsAnchorErrorCode.MaxAttemptsExceeded
        : CpsAnchorErrorCode.TransientError,
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
