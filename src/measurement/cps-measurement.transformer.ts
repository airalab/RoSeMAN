import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Message } from '@buf/airalab_sensors-social-proto.bufbuild_es/core/v1/message_pb.js';
import { encodeAddress } from '@polkadot/util-crypto';
import { MeasurementSourceType } from '../common/constants/measurement-source-type.enum.js';
import { SensorModel } from '../common/constants/sensor-model.enum.js';
import type { Measurement } from '../database/schemas/measurement.schema.js';
import type { VerifiedSignedEnvelope } from './protocol/envelope-signature-verifier.js';

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
  MissingGeo = 'MISSING_GEO',
  InvalidGeo = 'INVALID_GEO',
  MissingOwner = 'MISSING_OWNER',
  InvalidOwner = 'INVALID_OWNER',
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

/** Преобразует проверенное сообщение alpha-протокола в документ MongoDB. */
@Injectable()
export class CpsMeasurementTransformer {
  private readonly ownerSs58Prefix: number;

  /** Создаёт преобразователь с настроенным SS58-префиксом владельца. */
  constructor(config: ConfigService) {
    this.ownerSs58Prefix = config.get<number>('cps.ownerSs58Prefix', 32);
  }

  /**
   * Собирает одно измерение из всех публичных секций конверта.
   * @param envelope - конверт с проверенной Ed25519-подписью
   * @param message - декодированное сообщение устройства
   * @param sourceId - идемпотентный ключ CPS anchor
   * @returns документ измерения либо стабильная причина отклонения
   */
  transform(
    envelope: VerifiedSignedEnvelope,
    message: Message,
    sourceId: string,
  ): CpsMeasurementTransformResult {
    const timestamp = this.toTimestampSeconds(envelope.timestamp);
    if (timestamp === null)
      return this.failure(CpsMeasurementTransformErrorCode.InvalidTimestamp);

    const owner = this.toOwner(message.metadata?.owner);
    if (owner === null) {
      return this.failure(
        message.metadata?.owner.byteLength
          ? CpsMeasurementTransformErrorCode.InvalidOwner
          : CpsMeasurementTransformErrorCode.MissingOwner,
      );
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
    if (!collected.geo)
      return this.failure(CpsMeasurementTransformErrorCode.MissingGeo);
    if (!this.isValidGeo(collected.geo)) {
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
        geo: collected.geo,
        device_model: message.payload.case,
        owner,
        timestamp,
        source_type: MeasurementSourceType.CPS,
        source_id: sourceId,
      },
    };
  }

  /** Приводит миллисекунды uint64 к безопасным Unix-секундам. */
  private toTimestampSeconds(timestampMs: bigint): number | null {
    const seconds = timestampMs / 1000n;
    return seconds > 0n && seconds <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(seconds)
      : null;
  }

  /** Кодирует 32-байтовый ключ владельца в адрес SS58. */
  private toOwner(owner: Uint8Array | undefined): string | null {
    if (!owner || owner.byteLength !== 32) return null;
    try {
      return encodeAddress(owner, this.ownerSs58Prefix);
    } catch {
      return null;
    }
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
    const mappings: Record<string, [string, string]> = {
      temperature: ['temperature', 'celsius'],
      humidity: ['humidity', 'percent'],
      pressure: ['pressure', 'pascal'],
      co2: ['co2', 'ppm'],
      pm25: ['pm25', 'ugM3'],
      pm10: ['pm10', 'ugM3'],
      noiseMax: ['noise_max', 'db'],
      noiseAvg: ['noise_avg', 'db'],
    };
    const mapping = mappings[measurementCase];
    if (!mapping) return null;
    if (sensorCase === 'gps') return null;
    return { key: mapping[0], value: value[mapping[1]] as number };
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
