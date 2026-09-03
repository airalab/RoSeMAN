import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CpsBackfillErrorCode } from '../common/constants/cps-backfill-error-code.enum.js';
import { CpsBackfillStatus } from '../common/constants/cps-backfill-status.enum.js';
import {
  ConnectivityPayloadDecodeStatus,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
} from '../common/constants/connectivity-storage.enum.js';
import { CpsAnchorRepository } from '../database/repositories/cps-anchor.repository.js';
import {
  ConnectivityPayloadConflictError,
  ConnectivityPayloadRepository,
} from '../database/repositories/connectivity-payload.repository.js';
import {
  type ConnectivityRecordInput,
  ConnectivityRecordRepository,
} from '../database/repositories/connectivity-record.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
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

export interface CpsBackfillOptions {
  readonly dryRun: boolean;
  readonly startBlock?: number;
  readonly endBlock?: number;
  readonly cid?: string;
  readonly limit: number;
  readonly includeCompleted?: boolean;
}

export interface CpsBackfillFailure {
  readonly sourceKey: string;
  readonly cid: string;
  readonly code: string;
}

export interface CpsBackfillReport {
  readonly dryRun: boolean;
  readonly anchors: number;
  processed: number;
  processedWithErrors: number;
  failed: number;
  records: number;
  invalid: number;
  unsupported: number;
  privateSections: number;
  privateOnly: number;
  readonly failures: CpsBackfillFailure[];
}

interface StoredAnchorResult {
  readonly recordCount: number;
  readonly invalidCount: number;
  readonly unsupportedCount: number;
  readonly privateSectionCount: number;
  readonly privateOnlyCount: number;
}

/** Выполняет canonical-only backfill завершённых CPS anchors. */
@Injectable()
export class CpsBackfillService {
  private readonly wireFormat: ProtocolBatchWireFormat;
  private readonly batchDecoder: SignedEnvelopeBatchPayloadDecoder;
  private readonly signatureVerifier = new Ed25519EnvelopeSignatureVerifier();
  private readonly messageDecoder = new SignedEnvelopeMessageDecoder();

  /**
   * Создаёт backfill service с теми же decoder limits, что и online processor.
   * @param config - проверенная конфигурация CPS
   * @param ipfsFetcher - загрузчик immutable IPFS content
   * @param anchorRepo - repository ingestion anchors и backfill state
   * @param payloadRepo - repository lossless payload
   * @param recordRepo - repository canonical records
   * @param recordMapper - mapper protocol read model
   */
  constructor(
    config: ConfigService,
    private readonly ipfsFetcher: IpfsFetcherService,
    private readonly anchorRepo: CpsAnchorRepository,
    private readonly payloadRepo: ConnectivityPayloadRepository,
    private readonly recordRepo: ConnectivityRecordRepository,
    private readonly recordMapper: ConnectivityRecordMapper,
  ) {
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

  /**
   * Обрабатывает один ограниченный batch anchors и возвращает агрегированный отчёт.
   * @param options - dry-run, диапазон, CID, limit и режим повторной обработки
   * @returns безопасный отчёт без payload, ключей и ciphertext
   */
  async run(options: CpsBackfillOptions): Promise<CpsBackfillReport> {
    const anchors = await this.anchorRepo.findBackfillCandidates(options);
    const report: CpsBackfillReport = {
      dryRun: options.dryRun,
      anchors: anchors.length,
      processed: 0,
      processedWithErrors: 0,
      failed: 0,
      records: 0,
      invalid: 0,
      unsupported: 0,
      privateSections: 0,
      privateOnly: 0,
      failures: [],
    };
    if (options.dryRun) return report;

    for (const anchor of anchors) {
      await this.processAnchor(anchor, report);
    }
    return report;
  }

  /** Обрабатывает один anchor и изолирует его ошибку от остальных кандидатов. */
  private async processAnchor(
    anchor: CpsAnchorDocument,
    report: CpsBackfillReport,
  ): Promise<void> {
    await this.anchorRepo.markBackfillStarted(anchor.source_key, new Date());
    try {
      const result = await this.storeCanonical(anchor);
      const hasErrors = result.invalidCount > 0 || result.unsupportedCount > 0;
      await this.anchorRepo.updateBackfillResult(
        anchor.source_key,
        hasErrors
          ? CpsBackfillStatus.ProcessedWithErrors
          : CpsBackfillStatus.Processed,
        {
          ...result,
          ...(hasErrors
            ? { errorCode: CpsBackfillErrorCode.PartialErrors }
            : {}),
        },
      );
      report.processed += hasErrors ? 0 : 1;
      report.processedWithErrors += hasErrors ? 1 : 0;
      report.records += result.recordCount;
      report.invalid += result.invalidCount;
      report.unsupported += result.unsupportedCount;
      report.privateSections += result.privateSectionCount;
      report.privateOnly += result.privateOnlyCount;
    } catch (error) {
      const code = this.toErrorCode(error);
      await this.anchorRepo.updateBackfillResult(
        anchor.source_key,
        CpsBackfillStatus.Error,
        {
          recordCount: 0,
          invalidCount: 0,
          unsupportedCount: 0,
          privateSectionCount: 0,
          privateOnlyCount: 0,
          errorCode: code,
          errorMessage: this.toErrorMessage(error),
        },
      );
      report.failed += 1;
      report.failures.push({
        sourceKey: anchor.source_key,
        cid: anchor.cid,
        code,
      });
    }
  }

  /** Сохраняет raw payload и occurrence records без записи legacy measurements. */
  private async storeCanonical(
    anchor: CpsAnchorDocument,
  ): Promise<StoredAnchorResult> {
    const bytes = await this.ipfsFetcher.fetchBytes(anchor.cid);
    await this.payloadRepo.upsertFetched({
      payloadKey: anchor.source_key,
      nodeId: anchor.node_id,
      block: anchor.block,
      cid: anchor.cid,
      wireFormat: this.wireFormat,
      rawPayload: bytes,
    });

    let batch;
    try {
      batch = await this.batchDecoder.decode(bytes, this.wireFormat);
    } catch (error) {
      if (error instanceof ProtocolBatchDecodeError) {
        await this.payloadRepo.updateDecodeStatus(
          anchor.source_key,
          ConnectivityPayloadDecodeStatus.Error,
          { code: error.code, message: error.message },
        );
      }
      throw error;
    }

    const structuralErrors = new Map<number, string[]>();
    for (const error of batch.errors) {
      const codes = structuralErrors.get(error.envelopeIndex) ?? [];
      codes.push(error.code);
      structuralErrors.set(error.envelopeIndex, codes);
    }
    let recordCount = 0;
    let invalidCount = structuralErrors.size;
    let unsupportedCount = 0;
    let privateSectionCount = 0;
    let privateOnlyCount = 0;

    for (const [envelopeIndex, codes] of structuralErrors) {
      await this.recordRepo.upsertRecord(
        this.recordMapper.createInvalidEnvelopeRecord(
          anchor,
          envelopeIndex,
          codes.join(','),
        ),
      );
      recordCount += 1;
    }

    for (const envelope of batch.envelopes) {
      let record: ConnectivityRecordInput =
        this.recordMapper.createEnvelopeRecord(anchor, envelope);
      await this.recordRepo.upsertRecord(record);
      recordCount += 1;

      const verification = await this.signatureVerifier.verify(envelope);
      if (!verification.verified) {
        invalidCount += 1;
        record = {
          ...record,
          signature_status: ConnectivitySignatureStatus.Invalid,
          decode_status: ConnectivityRecordDecodeStatus.NotAttempted,
          error_code: verification.reason,
        };
        await this.recordRepo.upsertRecord(record);
        continue;
      }

      try {
        const message = this.messageDecoder.decode(verification.envelope);
        record = this.recordMapper.applyDecodedMessage(record, message);
        if (
          message.payload.case !== 'urban' &&
          message.payload.case !== 'insight'
        ) {
          unsupportedCount += 1;
        } else {
          const payload = message.payload.value;
          const privateCount = payload.private.length;
          privateSectionCount += privateCount;
          if (payload.public.length === 0 && privateCount > 0) {
            privateOnlyCount += 1;
          }
        }
        await this.recordRepo.upsertRecord(record);
      } catch (error) {
        if (!(error instanceof ProtocolMessageDecodeError)) throw error;
        invalidCount += 1;
        await this.recordRepo.upsertRecord({
          ...record,
          signature_status: ConnectivitySignatureStatus.Valid,
          decode_status: ConnectivityRecordDecodeStatus.Error,
          error_code: 'MALFORMED_MESSAGE',
        });
      }
    }

    const hasErrors = invalidCount > 0 || unsupportedCount > 0;
    await this.payloadRepo.updateDecodeStatus(
      anchor.source_key,
      hasErrors
        ? ConnectivityPayloadDecodeStatus.DecodedWithErrors
        : ConnectivityPayloadDecodeStatus.Decoded,
    );
    return {
      recordCount,
      invalidCount,
      unsupportedCount,
      privateSectionCount,
      privateOnlyCount,
    };
  }

  /** Возвращает стабильный код без анализа чувствительных данных ошибки. */
  private toErrorCode(error: unknown): string {
    if (error instanceof ProtocolBatchDecodeError) return error.code;
    if (error instanceof ConnectivityPayloadConflictError) return error.code;
    return CpsBackfillErrorCode.Failed;
  }

  /** Ограничивает диагностическое сообщение и не включает payload в отчёт. */
  private toErrorMessage(error: unknown): string {
    return (error instanceof Error ? error.message : String(error)).slice(
      0,
      500,
    );
  }
}
