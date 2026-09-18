import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
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
  @MaxLength(20)
  @Matches(/^(0|[1-9][0-9]*)$/)
  node_id?: string;

  @IsOptional()
  @IsIn([ConnectivityPayloadType.Urban, ConnectivityPayloadType.Insight])
  payload_type?: ConnectivityPayloadType;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  @Matches(/^[a-z0-9_]+$/)
  measurement_type?: string;
}
