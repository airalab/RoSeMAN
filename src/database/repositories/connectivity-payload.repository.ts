import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  CONNECTIVITY_ENVELOPE_SCHEMA_PACKAGE,
  CONNECTIVITY_SCHEMA_REVISION,
} from '../../common/constants/connectivity-protocol.constants.js';
import {
  ConnectivityPayloadDecodeStatus,
  ConnectivitySourceType,
  type ProtocolBatchWireFormat,
} from '../../common/constants/connectivity-storage.enum.js';
import {
  ConnectivityPayload,
  type ConnectivityPayloadDocument,
} from '../schemas/connectivity-payload.schema.js';

export interface ConnectivityPayloadInput {
  readonly payloadKey: string;
  readonly sourceType?: string;
  readonly nodeId?: string;
  readonly block?: number;
  readonly cid?: string;
  readonly wireFormat: ProtocolBatchWireFormat;
  readonly rawPayload: Uint8Array;
  readonly fetchedAt?: Date;
}

/** Ошибка несовпадения bytes для уже известного immutable payload key. */
export class ConnectivityPayloadConflictError extends Error {
  readonly code = 'PAYLOAD_CONTENT_CONFLICT';

  /**
   * Создаёт безопасную ошибку без включения payload или checksum в сообщение.
   * @param payloadKey - конфликтующий детерминированный ключ
   * @param options - исходная ошибка unique index
   */
  constructor(
    readonly payloadKey: string,
    options?: ErrorOptions,
  ) {
    super('Connectivity payload content conflicts with existing key', options);
    this.name = ConnectivityPayloadConflictError.name;
  }
}

/** Репозиторий lossless payload Connectivity Protocol. */
@Injectable()
export class ConnectivityPayloadRepository {
  /**
   * Создаёт репозиторий поверх Mongoose-модели payload.
   * @param model - модель коллекции connectivity_payloads
   */
  constructor(
    @InjectModel(ConnectivityPayload.name)
    private readonly model: Model<ConnectivityPayloadDocument>,
  ) {}

  /**
   * Идемпотентно сохраняет точные полученные bytes до декодирования.
   * @param input - transport provenance, wire format и исходные bytes
   */
  async upsertFetched(input: ConnectivityPayloadInput): Promise<void> {
    const rawPayload = Buffer.from(input.rawPayload);
    const rawSha256 = createHash('sha256').update(rawPayload).digest('hex');
    const document = {
      payload_key: input.payloadKey,
      source_type: input.sourceType ?? ConnectivitySourceType.Cps,
      node_id: input.nodeId,
      block: input.block,
      cid: input.cid,
      wire_format: input.wireFormat,
      raw_payload: rawPayload,
      raw_size: rawPayload.byteLength,
      raw_sha256: rawSha256,
      schema_package: CONNECTIVITY_ENVELOPE_SCHEMA_PACKAGE,
      schema_revision: CONNECTIVITY_SCHEMA_REVISION,
      decode_status: ConnectivityPayloadDecodeStatus.Pending,
      fetched_at: input.fetchedAt ?? new Date(),
    };

    try {
      await this.model
        .updateOne(
          {
            payload_key: input.payloadKey,
            raw_size: rawPayload.byteLength,
            raw_sha256: rawSha256,
          },
          { $setOnInsert: document },
          { upsert: true },
        )
        .exec();
    } catch (error) {
      const code = (error as { readonly code?: unknown }).code;
      if (code === 11000) {
        throw new ConnectivityPayloadConflictError(input.payloadKey, {
          cause: error,
        });
      }
      throw error;
    }
  }

  /**
   * Фиксирует итог декодирования без изменения архивных bytes.
   * @param payloadKey - детерминированный ключ payload
   * @param status - терминальное состояние декодирования
   * @param error - безопасные код и сообщение ошибки без payload
   */
  async updateDecodeStatus(
    payloadKey: string,
    status: Exclude<
      ConnectivityPayloadDecodeStatus,
      ConnectivityPayloadDecodeStatus.Pending
    >,
    error?: { readonly code: string; readonly message: string },
  ): Promise<void> {
    await this.model
      .updateOne(
        { payload_key: payloadKey },
        {
          $set: {
            decode_status: status,
            decoded_at: new Date(),
            ...(error
              ? { error_code: error.code, error_message: error.message }
              : {}),
          },
          ...(!error ? { $unset: { error_code: '', error_message: '' } } : {}),
        },
      )
      .exec();
  }
}
