import { Injectable } from '@nestjs/common';
import type { Message } from '@buf/airalab_connectivity-protocol.bufbuild_es/core/v1/message_pb.js';
import { MeasurementSourceType } from '../common/constants/measurement-source-type.enum.js';
import { SensorModel } from '../common/constants/sensor-model.enum.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import type { CpsAnchorDocument } from '../database/schemas/cps-anchor.schema.js';
import type { VerifiedSignedEnvelope } from './protocol/envelope-signature-verifier.js';
import {
  MessageMetadataValidationErrorCode,
  validateMessageMetadata,
} from './protocol/message-metadata.validator.js';

interface SensorValue {
  readonly measurement?: {
    readonly case?: string;
    readonly value?: unknown;
  };
  readonly lat?: number;
  readonly lon?: number;
}

interface PublicSensor {
  readonly sensor: {
    readonly case?: string;
    readonly value?: SensorValue;
  };
}

export enum CpsMeasurementTransformErrorCode {
  InvalidGeo = 'INVALID_GEO',
  MissingOwner = 'MISSING_OWNER',
  NodeIdMismatch = 'NODE_ID_MISMATCH',
  UnsupportedPayload = 'UNSUPPORTED_PAYLOAD',
  NoMeasurements = 'NO_MEASUREMENTS',
  InvalidTimestamp = 'INVALID_TIMESTAMP',
  InvalidMeasurement = 'INVALID_MEASUREMENT',
}

export type CpsMeasurementTransformResult =
  | { readonly transformed: true; readonly measurement: Measurement }
  | {
      readonly transformed: false;
      readonly code: CpsMeasurementTransformErrorCode;
    };

/** Преобразует проверенное сообщение Connectivity Protocol в документ MongoDB. */
@Injectable()
export class CpsMeasurementTransformer {
  /**
   * Собирает одно измерение из всех публичных секций конверта.
   * @param envelope - конверт с проверенной Ed25519-подписью
   * @param message - декодированное сообщение устройства
   * @param anchor - CPS-якорь для проверки NodeId и разрешения владельца
   * @returns документ измерения либо стабильная причина отклонения
   */
  transform(
    envelope: VerifiedSignedEnvelope,
    message: Message,
    anchor: Pick<CpsAnchorDocument, 'source_key' | 'node_id' | 'owner'>,
  ): CpsMeasurementTransformResult {
    const metadata = validateMessageMetadata(message, anchor.node_id);
    if (!metadata.valid) {
      return this.failure(
        metadata.code === MessageMetadataValidationErrorCode.NodeIdMismatch
          ? CpsMeasurementTransformErrorCode.NodeIdMismatch
          : CpsMeasurementTransformErrorCode.InvalidTimestamp,
      );
    }
    const timestamp = Number(metadata.timestamp / 1000n);

    if (!anchor.owner) {
      return this.failure(CpsMeasurementTransformErrorCode.MissingOwner);
    }

    if (
      message.payload.case !== 'urban' &&
      message.payload.case !== 'insight'
    ) {
      return this.failure(CpsMeasurementTransformErrorCode.UnsupportedPayload);
    }

    const collected = this.collectPublicMeasurements(
      message.payload.value.public,
    );
    if (collected.invalidMeasurement) {
      return this.failure(CpsMeasurementTransformErrorCode.InvalidMeasurement);
    }
    if (collected.geo && !this.isValidGeo(collected.geo)) {
      return this.failure(CpsMeasurementTransformErrorCode.InvalidGeo);
    }
    if (Object.keys(collected.measurement).length === 0) {
      return this.failure(CpsMeasurementTransformErrorCode.NoMeasurements);
    }

    return {
      transformed: true,
      measurement: {
        sensor_id: Buffer.from(envelope.sensorId).toString('hex'),
        model: SensorModel.STATIC,
        measurement: collected.measurement,
        ...(collected.geo ? { geo: collected.geo } : {}),
        device_model: message.payload.case,
        owner: anchor.owner,
        timestamp,
        source_type: MeasurementSourceType.CPS,
        source_id: anchor.source_key,
      },
    };
  }

  /** Собирает GPS и скалярные показатели из публичных секций устройства. */
  private collectPublicMeasurements(sensors: PublicSensor[]): {
    geo?: { lat: number; lng: number };
    measurement: Record<string, number>;
    invalidMeasurement: boolean;
  } {
    let geo: { lat: number; lng: number } | undefined;
    const measurement: Record<string, number> = {};
    let invalidMeasurement = false;

    for (const entry of sensors) {
      const sensor = entry.sensor;
      if (sensor.case === 'gps' && sensor.value) {
        geo = {
          lat: sensor.value.lat as number,
          lng: sensor.value.lon as number,
        };
        continue;
      }
      const scalar = sensor.value?.measurement;
      if (!scalar?.case || !scalar.value) continue;
      const mapped = this.mapMeasurement(
        sensor.case,
        scalar.case,
        scalar.value,
      );
      if (!mapped) continue;
      if (!Number.isFinite(mapped.value)) {
        invalidMeasurement = true;
        continue;
      }
      measurement[mapped.key] = mapped.value;
    }

    return { geo, measurement, invalidMeasurement };
  }

  /** Сопоставляет protobuf oneof с существующими ключами measurement. */
  private mapMeasurement(
    sensorCase: string | undefined,
    measurementCase: string,
    rawValue: unknown,
  ): { key: string; value: number } | null {
    const value = rawValue as Record<string, unknown>;
    const mappings: Record<string, [string, string, number]> = {
      temperature: ['temperature', 'centiCelsius', 100],
      humidity: ['humidity', 'centiPercent', 100],
      pressure: ['pressure', 'deciPascal', 10],
      co2: ['co2', 'ppm', 1],
      pm25: ['pm25', 'deciUgM3', 10],
      pm10: ['pm10', 'deciUgM3', 10],
      noiseMax: ['noise_max', 'db', 1],
      noiseAvg: ['noise_avg', 'db', 1],
    };
    const mapping = mappings[measurementCase];
    if (!mapping) return null;
    if (sensorCase === 'gps') return null;
    return {
      key: mapping[0],
      value: (value[mapping[1]] as number) / mapping[2],
    };
  }

  /** Проверяет конечность и диапазон координат WGS84. */
  private isValidGeo(geo: { lat: number; lng: number }): boolean {
    return (
      Number.isFinite(geo.lat) &&
      Number.isFinite(geo.lng) &&
      geo.lat >= -90 &&
      geo.lat <= 90 &&
      geo.lng >= -180 &&
      geo.lng <= 180
    );
  }

  /** Создаёт отрицательный результат без исключения и исходного payload. */
  private failure(
    code: CpsMeasurementTransformErrorCode,
  ): CpsMeasurementTransformResult {
    return { transformed: false, code };
  }
}
