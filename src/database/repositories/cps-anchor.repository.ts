import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CpsAnchorStatus } from '../../common/constants/cps-anchor-status.enum.js';
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
}
