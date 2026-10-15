import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { decodeAddress } from '@polkadot/util-crypto';
import { ConnectivityPayloadType } from '../../../common/constants/connectivity-storage.enum.js';

export const MAX_CONNECTIVITY_DATE_MILLISECONDS = 8_640_000_000_000_000;
const SENSOR_ID_HEX_PATTERN = /^[0-9a-f]{64}$/;
const SENSOR_ID_BYTE_LENGTH = 32;
const MAX_SENSOR_ID_INPUT_LENGTH = 64;

/**
 * Преобразует SS58-адрес сенсора во внутренний lowercase hex без `0x`.
 * Уже канонический hex сохраняется для обратной совместимости.
 * @param value - исходное значение query-параметра
 * @returns канонический hex либо исходное значение для последующей валидации
 */
export function normalizeSensorIdQueryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (SENSOR_ID_HEX_PATTERN.test(value)) return value;
  if (value.length > MAX_SENSOR_ID_INPUT_LENGTH) return value;

  try {
    const publicKey = decodeAddress(value);
    if (publicKey.byteLength !== SENSOR_ID_BYTE_LENGTH) return value;
    return Buffer.from(publicKey).toString('hex');
  } catch {
    return value;
  }
}

/** Базовые фильтры публичных запросов сообщений Connectivity Protocol. */
export class ConnectivityMessageBaseFilterQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    normalizeSensorIdQueryValue(value),
  )
  @IsString()
  @MaxLength(MAX_SENSOR_ID_INPUT_LENGTH)
  @Matches(SENSOR_ID_HEX_PATTERN)
  sensor_id?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^(0|[1-9][0-9]*)$/)
  node_id?: string;

  @IsOptional()
  @IsIn([ConnectivityPayloadType.Urban, ConnectivityPayloadType.Insight])
  payload_type?: ConnectivityPayloadType;
}

/** Фильтры сообщений, допускающие ограничение по типу измерения. */
export class ConnectivityMessageFilterQueryDto extends ConnectivityMessageBaseFilterQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9_]+$/)
  type?: string;
}
