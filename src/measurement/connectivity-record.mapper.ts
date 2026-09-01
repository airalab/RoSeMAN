import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import { encodeAddress } from '@polkadot/util-crypto';
import {
  CONNECTIVITY_MESSAGE_SCHEMA_PACKAGE,
  CONNECTIVITY_PROTOCOL,
  CONNECTIVITY_SCHEMA_REVISION,
} from '../common/constants/connectivity-protocol.constants.js';
import {
  ConnectivityLegacyProjectionStatus,
  ConnectivityPayloadType,
  ConnectivityRecordDecodeStatus,
  ConnectivitySignatureStatus,
  ConnectivitySourceType,
  ConnectivityStructureStatus,
} from '../common/constants/connectivity-storage.enum.js';
import type { ConnectivityRecordInput } from '../database/repositories/connectivity-record.repository.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type {
  ConnectivityPrivateSection,
  ConnectivityPublicEvent,
} from '../database/schemas/connectivity-record.schema.js';
import type { UntrustedSignedEnvelope } from './protocol/signed-envelope.types.js';

interface ScalarMeasurement {
  readonly case?: string;
  readonly value?: Record<string, unknown>;
}

interface PublicSensorValue {
  readonly measurement?: ScalarMeasurement;
  readonly lat?: number;
  readonly lon?: number;
  readonly heightM?: number;
}

interface PublicSensor {
  readonly sensor: {
    readonly case?: string;
    readonly value?: PublicSensorValue;
  };
}

interface PrivateSection {
  readonly version: number;
  readonly algorithm: string;
  readonly from: Uint8Array;
  readonly nonce: Uint8Array;
  readonly ciphertext: Uint8Array;
}

const SCALAR_MAPPINGS: Record<
  string,
  { readonly field: string; readonly unit: string }
> = {
  temperature: { field: 'celsius', unit: 'celsius' },
  humidity: { field: 'percent', unit: 'percent' },
  pressure: { field: 'pascal', unit: 'pascal' },
  co2: { field: 'ppm', unit: 'ppm' },
  pm25: { field: 'ugM3', unit: 'ug/m3' },
  pm10: { field: 'ugM3', unit: 'ug/m3' },
  noiseMax: { field: 'db', unit: 'db' },
  noiseAvg: { field: 'db', unit: 'db' },
};

/** Строит lossless-связанную read model одного protocol envelope. */
@Injectable()
export class ConnectivityRecordMapper {
  private readonly ownerSs58Prefix: number;

  /**
   * Создаёт mapper с согласованным SS58-префиксом владельца.
   * @param config - конфигурация CPS processor
   */
  constructor(config: ConfigService) {
    this.ownerSs58Prefix = config.get<number>('cps.ownerSs58Prefix', 32);
  }

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
    const recordedAt = this.toRecordedAt(envelope.timestamp);
    return {
      ...this.createProvenance(anchor, envelope.envelopeIndex),
      sensor_id: Buffer.from(envelope.sensorId).toString('hex'),
      sensor_id_raw: Buffer.from(envelope.sensorId),
      timestamp_ms: envelope.timestamp.toString(),
      ...(recordedAt ? { recorded_at: recordedAt } : {}),
      nonce: Buffer.from(envelope.nonce),
      message_raw: Buffer.from(envelope.message),
      signature: Buffer.from(envelope.signature),
      structure_status: ConnectivityStructureStatus.Valid,
      signature_status: ConnectivitySignatureStatus.Pending,
      decode_status: ConnectivityRecordDecodeStatus.Pending,
      public_events: [],
      private_sections: [],
      legacy_projection_status: ConnectivityLegacyProjectionStatus.Pending,
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
      public_events: [],
      private_sections: [],
      legacy_projection_status: ConnectivityLegacyProjectionStatus.NotAttempted,
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
    const ownerRaw = message.metadata?.owner;
    const ownerFields = {
      ...(ownerRaw ? { owner_raw: Buffer.from(ownerRaw) } : {}),
      ...(ownerRaw ? this.toOwner(ownerRaw) : {}),
    };

    if (
      message.payload.case !== 'urban' &&
      message.payload.case !== 'insight'
    ) {
      return {
        ...record,
        ...ownerFields,
        signature_status: ConnectivitySignatureStatus.Valid,
        decode_status: ConnectivityRecordDecodeStatus.Unsupported,
        payload_type: ConnectivityPayloadType.Unknown,
      };
    }

    const payload = message.payload.value;

    return {
      ...record,
      ...ownerFields,
      signature_status: ConnectivitySignatureStatus.Valid,
      decode_status: ConnectivityRecordDecodeStatus.Decoded,
      payload_type: this.toPayloadType(message.payload.case),
      public_events: this.mapPublicEvents(payload.public),
      private_sections: this.mapPrivateSections(payload.private),
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
    | 'source_id'
    | 'node_id'
    | 'block'
    | 'cid'
    | 'protocol'
    | 'schema_package'
    | 'schema_revision'
  > {
    return {
      record_key: `${anchor.source_key}:${envelopeIndex}`,
      payload_key: anchor.source_key,
      envelope_index: envelopeIndex,
      source_type: ConnectivitySourceType.Cps,
      source_id: anchor.source_key,
      node_id: anchor.node_id,
      block: anchor.block,
      cid: anchor.cid,
      protocol: CONNECTIVITY_PROTOCOL,
      schema_package: CONNECTIVITY_MESSAGE_SCHEMA_PACKAGE,
      schema_revision: CONNECTIVITY_SCHEMA_REVISION,
    };
  }

  /** Преобразует uint64 миллисекунды в Date только в допустимом диапазоне BSON. */
  private toRecordedAt(timestampMs: bigint): Date | undefined {
    const maxDateMilliseconds = 8_640_000_000_000_000n;
    if (timestampMs <= 0n || timestampMs > maxDateMilliseconds)
      return undefined;
    const date = new Date(Number(timestampMs));
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  /** Возвращает SS58 owner только для корректного 32-байтового ключа. */
  private toOwner(owner: Uint8Array): { readonly owner?: string } {
    if (owner.byteLength !== 32) return {};
    try {
      return { owner: encodeAddress(owner, this.ownerSs58Prefix) };
    } catch {
      return {};
    }
  }

  /** Нормализует известный oneof payload, не отбрасывая неизвестный вариант. */
  private toPayloadType(
    payloadCase: string | undefined,
  ): ConnectivityPayloadType {
    if (payloadCase === 'urban') return ConnectivityPayloadType.Urban;
    if (payloadCase === 'insight') return ConnectivityPayloadType.Insight;
    return ConnectivityPayloadType.Unknown;
  }

  /** Преобразует public events по одному, не меняя их порядок и повторы. */
  private mapPublicEvents(
    sensors: readonly PublicSensor[],
  ): ConnectivityPublicEvent[] {
    return sensors.map((entry) => {
      const sensorType = entry.sensor.case ?? 'unknown';
      const value = entry.sensor.value;
      if (sensorType === 'gps' && value) {
        return {
          sensor_type: sensorType,
          measurement_type: 'location',
          unit: 'wgs84',
          lat: value.lat,
          lon: value.lon,
          height_m: value.heightM,
        };
      }

      const scalar = value?.measurement;
      const measurementType = scalar?.case;
      const mapping = measurementType
        ? SCALAR_MAPPINGS[measurementType]
        : undefined;
      if (!measurementType || !mapping || !scalar?.value) {
        return { sensor_type: sensorType };
      }

      return {
        sensor_type: sensorType,
        measurement_type: measurementType,
        value: scalar.value[mapping.field] as number,
        unit: mapping.unit,
      };
    });
  }

  /** Копирует encrypted private sections без расшифровки и изменения порядка. */
  private mapPrivateSections(
    sections: readonly PrivateSection[],
  ): ConnectivityPrivateSection[] {
    return sections.map((section) => ({
      version: section.version,
      algorithm: section.algorithm,
      from: Buffer.from(section.from),
      nonce: Buffer.from(section.nonce),
      ciphertext: Buffer.from(section.ciphertext),
    }));
  }
}
