import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ConnectivityPayloadType } from '../../../common/constants/connectivity-storage.enum.js';

export const MAX_CONNECTIVITY_DATE_MILLISECONDS = 8_640_000_000_000_000;

/** Общие фильтры публичных запросов сообщений Connectivity Protocol. */
export class ConnectivityMessageFilterQueryDto {
  @IsOptional()
  @IsString()
  @Matches(/^[0-9a-f]{64}$/)
  sensor_id?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  @Matches(/^[1-9A-HJ-NP-Za-km-z]+$/)
  owner?: string;

  @IsOptional()
  @IsIn([ConnectivityPayloadType.Urban, ConnectivityPayloadType.Insight])
  payload_type?: ConnectivityPayloadType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9_]+$/)
  measurement_type?: string;
}
