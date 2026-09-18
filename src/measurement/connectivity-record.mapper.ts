import { Injectable } from '@nestjs/common';
import { toJson, type JsonObject } from '@bufbuild/protobuf';
import {
  type Message,
  MessageSchema,
} from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import {
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivitySourceType,
  ConnectivityStructureStatus,
} from '../common/constants/connectivity-storage.enum.js';
import type { ConnectivityRecordInput } from '../database/repositories/connectivity-record.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import { validateMessageMetadata } from './protocol/message-metadata.validator.js';
import type { UntrustedSignedEnvelope } from './protocol/signed-envelope.types.js';

interface ScalarMeasurement {
  readonly case?: string;
  readonly value?: Record<string, unknown>;
}

interface PublicSensorValue {
  readonly measurement?: ScalarMeasurement;
  readonly lat?: number;
}

interface PublicSensor {
  readonly sensor: {
    readonly case?: string;
    readonly value?: PublicSensorValue;
  };
}

const SUPPORTED_MEASUREMENT_TYPES = new Set([
  'temperature',
  'humidity',
  'pressure',
  'co2',
  'pm25',
  'pm10',
  'noiseMax',
  'noiseAvg',
]);

/** Строит lossless-связанную read model одного protocol envelope. */
@Injectable()
export class ConnectivityRecordMapper {
  /**
   * Создаёт запись структурно корректного envelope до проверки подписи.
   * @param anchor - источник occurrence в CPS
   * @param envelope - недоверенный envelope с точными вложенными bytes
   * @returns начальная каноническая запись
   */
  createEnvelopeRecord(
    anchor: CpsAnchorDocument,
    envelope: UntrustedSignedEnvelope,
  ): ConnectivityRecordInput {
    return {
      ...this.createProvenance(anchor, envelope.envelopeIndex),
      sensor_id: Buffer.from(envelope.sensorId).toString('hex'),
      sensor_id_raw: Buffer.from(envelope.sensorId),
      nonce: Buffer.from(envelope.nonce),
      message_raw: Buffer.from(envelope.message),
      signature: Buffer.from(envelope.signature),
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Pending,
      decode_status: ConnectivityRecordDecodeStatus.Pending,
      measurement_types: [],
    };
  }

  /**
   * Создаёт диагностическую запись структурно неверного envelope.
   * Точные поля остаются доступными в архивном raw payload.
   * @param anchor - источник occurrence в CPS
   * @param envelopeIndex - позиция envelope в batch
   * @param errorCode - стабильный код структурной ошибки
   * @returns минимальная каноническая запись ошибки
   */
  createInvalidEnvelopeRecord(
    anchor: CpsAnchorDocument,
    envelopeIndex: number,
    errorCode: string,
  ): ConnectivityRecordInput {
    return {
      ...this.createProvenance(anchor, envelopeIndex),
      structure_status: ConnectivityStructureStatus.Invalid,
      signature_status: ConnectivitySignatureStatus.NotChecked,
      decode_status: ConnectivityRecordDecodeStatus.NotAttempted,
      error_code: errorCode,
      measurement_types: [],
    };
  }

  /**
   * Дополняет каноническую запись всеми декодированными public/private данными.
   * @param record - запись проверенного envelope
   * @param message - декодированное core.v1.Message
   * @returns запись с индексируемой read model
   */
  applyDecodedMessage(
    record: ConnectivityRecordInput,
    message: Message,
  ): ConnectivityRecordInput {
    const messageJson = this.toMessageJson(message);
    const metadata = validateMessageMetadata(message, record.node_id ?? '');
    const timestampFields = message.metadata
      ? { timestamp_ms: message.metadata.timestamp.toString() }
      : {};

    if (!metadata.valid) {
      return {
        ...record,
        ...timestampFields,
        message_json: messageJson,
        signature_status: ConnectivitySignatureStatus.Valid,
        decode_status: ConnectivityRecordDecodeStatus.Error,
        error_code: metadata.code,
      };
    }

    const metadataFields = {
      timestamp_ms: metadata.timestamp.toString(),
      recorded_at: metadata.recordedAt,
    };

    if (
      message.payload.case !== 'urban' &&
      message.payload.case !== 'insight'
    ) {
      return {
        ...record,
        ...metadataFields,
        message_json: messageJson,
        signature_status: ConnectivitySignatureStatus.Valid,
        decode_status: ConnectivityRecordDecodeStatus.Unsupported,
        payload_type: ConnectivityPayloadType.Unknown,
      };
    }

    const payload = message.payload.value;

    return {
      ...record,
      ...metadataFields,
      message_json: messageJson,
      signature_status: ConnectivitySignatureStatus.Valid,
      decode_status: ConnectivityRecordDecodeStatus.Decoded,
      payload_type: this.toPayloadType(message.payload.case),
      measurement_types: this.mapMeasurementTypes(payload.public),
    };
  }

  /** Собирает общие поля идентичности и provenance записи. */
  private createProvenance(
    anchor: CpsAnchorDocument,
    envelopeIndex: number,
  ): Pick<
    ConnectivityRecordInput,
    | 'record_key'
    | 'payload_key'
    | 'envelope_index'
    | 'source_type'
    | 'node_id'
    | 'block'
    | 'cid'
  > {
    return {
      record_key: `${anchor.source_key}:${envelopeIndex}`,
      payload_key: anchor.source_key,
      envelope_index: envelopeIndex,
      source_type: ConnectivitySourceType.Cps,
      node_id: anchor.node_id,
      block: anchor.block,
      cid: anchor.cid,
    };
  }

  /** Создаёт protobuf JSON без изменения значений подписанного Message. */
  private toMessageJson(message: Message): JsonObject {
    return toJson(MessageSchema, message) as JsonObject;
  }

  /** Нормализует известный oneof payload, не отбрасывая неизвестный вариант. */
  private toPayloadType(
    payloadCase: string | undefined,
  ): ConnectivityPayloadType {
    if (payloadCase === 'urban') return ConnectivityPayloadType.Urban;
    if (payloadCase === 'insight') return ConnectivityPayloadType.Insight;
    return ConnectivityPayloadType.Unknown;
  }

  /** Собирает уникальные типы измерений для компактной API-фильтрации. */
  private mapMeasurementTypes(sensors: readonly PublicSensor[]): string[] {
    const measurementTypes = new Set<string>();
    for (const entry of sensors) {
      if (entry.sensor.case === 'gps' && entry.sensor.value) {
        measurementTypes.add('location');
        continue;
      }
      const measurement = entry.sensor.value?.measurement;
      if (
        measurement?.case &&
        measurement.value &&
        SUPPORTED_MEASUREMENT_TYPES.has(measurement.case)
      ) {
        measurementTypes.add(measurement.case);
      }
    }
    return [...measurementTypes];
  }
}
