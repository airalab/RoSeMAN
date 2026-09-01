import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CpsAnchorStatus } from '../../common/constants/cps-anchor-status.enum.js';
import { CpsBackfillStatus } from '../../common/constants/cps-backfill-status.enum.js';
import {
  createCpsAnchorSourceKey,
  normalizeCpsNodeId,
} from '../../common/utils/cps-node-id.util.js';
import {
  CpsAnchor,
  type CpsAnchorDocument,
} from '../schemas/cps-anchor.schema.js';

export interface CpsAnchorInput {
  readonly nodeId: bigint | string;
  readonly block: number;
  readonly cid: string;
  readonly owner?: string;
}

export interface CpsBackfillQuery {
  readonly startBlock?: number;
  readonly endBlock?: number;
  readonly cid?: string;
  readonly limit: number;
  readonly includeCompleted?: boolean;
}

export interface CpsBackfillResultDetails {
  readonly recordCount: number;
  readonly invalidCount: number;
  readonly unsupportedCount: number;
  readonly privateSectionCount: number;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly completedAt?: Date;
}

/**
 * Репозиторий идемпотентной очереди CPS anchors.
 */
@Injectable()
export class CpsAnchorRepository {
  /**
   * Создаёт репозиторий поверх зарегистрированной Mongoose-модели.
   * @param model - модель коллекции cps_anchors
   */
  constructor(
    @InjectModel(CpsAnchor.name)
    private readonly model: Model<CpsAnchorDocument>,
  ) {}

  /**
   * Добавляет CPS anchor только при первом появлении пары NodeId и CID.
   * @param data - подтверждённые данные финализированного CPS-события
   */
  async upsertAnchor(data: CpsAnchorInput): Promise<void> {
    if (!Number.isSafeInteger(data.block) || data.block < 0) {
      throw new RangeError('CPS anchor block must be a safe unsigned integer');
    }

    const nodeId = normalizeCpsNodeId(data.nodeId);
    const sourceKey = createCpsAnchorSourceKey(nodeId, data.cid);
    const anchor = {
      source_key: sourceKey,
      node_id: nodeId,
      block: data.block,
      cid: data.cid,
      owner: data.owner,
      status: CpsAnchorStatus.PENDING,
      attempt_count: 0,
      valid_envelope_count: 0,
      invalid_envelope_count: 0,
      envelope_count: 0,
      stored_record_count: 0,
      valid_signature_count: 0,
      invalid_signature_count: 0,
      decoded_count: 0,
      unsupported_count: 0,
      legacy_projection_count: 0,
      private_section_count: 0,
      backfill_attempt_count: 0,
    };

    await this.model
      .updateOne(
        { source_key: sourceKey },
        { $setOnInsert: anchor },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Атомарно захватывает следующий доступный anchor с ограниченной арендой.
   * Истёкшая аренда PROCESSING позволяет безопасно продолжить после перезапуска.
   * @param now - текущее время для сравнения retry и lease
   * @param leaseDurationMs - длительность аренды в миллисекундах
   * @returns захваченный документ либо null, если очередь пуста
   */
  async claimNext(
    now: Date,
    leaseDurationMs: number,
  ): Promise<CpsAnchorDocument | null> {
    if (!Number.isSafeInteger(leaseDurationMs) || leaseDurationMs <= 0) {
      throw new RangeError('CPS anchor lease duration must be positive');
    }

    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs);
    return this.model
      .findOneAndUpdate(
        {
          $or: [
            { status: CpsAnchorStatus.PENDING },
            {
              status: CpsAnchorStatus.RETRY_PENDING,
              available_at: { $lte: now },
            },
            {
              status: CpsAnchorStatus.PROCESSING,
              lease_expires_at: { $lte: now },
            },
          ],
        },
        {
          $set: {
            status: CpsAnchorStatus.PROCESSING,
            lease_expires_at: leaseExpiresAt,
          },
          $inc: { attempt_count: 1 },
          $unset: { error_code: '', error_message: '' },
        },
        { new: true, sort: { block: 1, createdAt: 1 } },
      )
      .exec();
  }

  /**
   * Обновляет состояние anchor и связанные результаты обработки.
   * Политика частично неверного batch остаётся ответственностью processor.
   * @param sourceKey - детерминированный ключ anchor
   * @param status - новое состояние очереди
   * @param details - счётчики, ошибка и время следующей попытки
   */
  async updateStatus(
    sourceKey: string,
    status: CpsAnchorStatus,
    details: {
      readonly validEnvelopeCount?: number;
      readonly invalidEnvelopeCount?: number;
      readonly envelopeCount?: number;
      readonly storedRecordCount?: number;
      readonly validSignatureCount?: number;
      readonly invalidSignatureCount?: number;
      readonly decodedCount?: number;
      readonly unsupportedCount?: number;
      readonly legacyProjectionCount?: number;
      readonly privateSectionCount?: number;
      readonly errorCode?: string;
      readonly errorMessage?: string;
      readonly availableAt?: Date;
    } = {},
  ): Promise<void> {
    const update: Record<string, unknown> = { status };

    if (details.validEnvelopeCount !== undefined) {
      update.valid_envelope_count = details.validEnvelopeCount;
    }
    if (details.invalidEnvelopeCount !== undefined) {
      update.invalid_envelope_count = details.invalidEnvelopeCount;
    }
    if (details.envelopeCount !== undefined) {
      update.envelope_count = details.envelopeCount;
    }
    if (details.storedRecordCount !== undefined) {
      update.stored_record_count = details.storedRecordCount;
    }
    if (details.validSignatureCount !== undefined) {
      update.valid_signature_count = details.validSignatureCount;
    }
    if (details.invalidSignatureCount !== undefined) {
      update.invalid_signature_count = details.invalidSignatureCount;
    }
    if (details.decodedCount !== undefined) {
      update.decoded_count = details.decodedCount;
    }
    if (details.unsupportedCount !== undefined) {
      update.unsupported_count = details.unsupportedCount;
    }
    if (details.legacyProjectionCount !== undefined) {
      update.legacy_projection_count = details.legacyProjectionCount;
    }
    if (details.privateSectionCount !== undefined) {
      update.private_section_count = details.privateSectionCount;
    }
    if (details.errorCode !== undefined) {
      update.error_code = details.errorCode;
    }
    if (details.errorMessage !== undefined) {
      update.error_message = details.errorMessage;
    }
    if (details.availableAt !== undefined) {
      update.available_at = details.availableAt;
    }

    await this.model
      .updateOne(
        { source_key: sourceKey },
        { $set: update, $unset: { lease_expires_at: '' } },
      )
      .exec();
  }

  /**
   * Возвращает число anchors, ожидающих первой или повторной обработки.
   * @returns размер доступной и отложенной очереди
   */
  async countPending(): Promise<number> {
    return this.model
      .countDocuments({
        status: {
          $in: [CpsAnchorStatus.PENDING, CpsAnchorStatus.RETRY_PENDING],
        },
      })
      .exec();
  }

  /**
   * Возвращает завершённые ingestion anchors для отдельного canonical backfill.
   * Основной queue status при этом не захватывается и не изменяется.
   * @param query - диапазон блоков, CID, limit и режим повторного запуска
   * @returns отсортированный batch кандидатов
   */
  async findBackfillCandidates(
    query: CpsBackfillQuery,
  ): Promise<CpsAnchorDocument[]> {
    this.validateBackfillQuery(query);
    const filter: Record<string, unknown> = {
      status: {
        $in: [CpsAnchorStatus.PROCESSED, CpsAnchorStatus.PROCESSED_WITH_ERRORS],
      },
    };
    const block: Record<string, number> = {};
    if (query.startBlock !== undefined) block.$gte = query.startBlock;
    if (query.endBlock !== undefined) block.$lte = query.endBlock;
    if (Object.keys(block).length > 0) filter.block = block;
    if (query.cid !== undefined) filter.cid = query.cid;
    if (!query.includeCompleted) {
      filter.backfill_status = {
        $nin: [
          CpsBackfillStatus.Processed,
          CpsBackfillStatus.ProcessedWithErrors,
        ],
      };
    }

    return this.model
      .find(filter)
      .sort({ block: 1, source_key: 1 })
      .limit(query.limit)
      .exec();
  }

  /**
   * Фиксирует начало попытки backfill отдельно от ingestion lease/status.
   * @param sourceKey - детерминированный ключ anchor
   * @param startedAt - время начала попытки
   */
  async markBackfillStarted(sourceKey: string, startedAt: Date): Promise<void> {
    await this.model
      .updateOne(
        { source_key: sourceKey },
        {
          $set: {
            backfill_status: CpsBackfillStatus.Processing,
            backfill_started_at: startedAt,
          },
          $inc: { backfill_attempt_count: 1 },
          $unset: {
            backfill_error_code: '',
            backfill_error_message: '',
          },
        },
      )
      .exec();
  }

  /**
   * Сохраняет терминальный результат backfill, не меняя рабочий status anchor.
   * @param sourceKey - детерминированный ключ anchor
   * @param status - терминальное состояние backfill
   * @param details - отдельные counters и безопасная диагностика
   */
  async updateBackfillResult(
    sourceKey: string,
    status: Exclude<CpsBackfillStatus, CpsBackfillStatus.Processing>,
    details: CpsBackfillResultDetails,
  ): Promise<void> {
    const error =
      details.errorCode !== undefined
        ? {
            backfill_error_code: details.errorCode,
            backfill_error_message: details.errorMessage,
          }
        : {};
    await this.model
      .updateOne(
        { source_key: sourceKey },
        {
          $set: {
            backfill_status: status,
            backfilled_at: details.completedAt ?? new Date(),
            backfill_record_count: details.recordCount,
            backfill_invalid_count: details.invalidCount,
            backfill_unsupported_count: details.unsupportedCount,
            backfill_private_section_count: details.privateSectionCount,
            ...error,
          },
          ...(details.errorCode === undefined
            ? {
                $unset: {
                  backfill_error_code: '',
                  backfill_error_message: '',
                },
              }
            : {}),
        },
      )
      .exec();
  }

  /** Проверяет безопасные числовые границы запроса backfill. */
  private validateBackfillQuery(query: CpsBackfillQuery): void {
    if (!Number.isSafeInteger(query.limit) || query.limit <= 0) {
      throw new RangeError(
        'CPS backfill limit must be a positive safe integer',
      );
    }
    for (const [name, value] of [
      ['startBlock', query.startBlock],
      ['endBlock', query.endBlock],
    ] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new RangeError(
          `CPS backfill ${name} must be a safe unsigned integer`,
        );
      }
    }
    if (
      query.startBlock !== undefined &&
      query.endBlock !== undefined &&
      query.startBlock > query.endBlock
    ) {
      throw new RangeError('CPS backfill startBlock must not exceed endBlock');
    }
  }
}
