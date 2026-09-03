import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import {
  ConnectivityMessageFilterQueryDto,
  MAX_CONNECTIVITY_DATE_MILLISECONDS,
} from './connectivity-message-filter-query.dto.js';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 1000;

/** Query DTO публичного списка сообщений Connectivity Protocol. */
export class ConnectivityMessageListQueryDto extends ConnectivityMessageFilterQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = DEFAULT_LIMIT;

  @IsOptional()
  @IsString()
  @MaxLength(1024)
  @Matches(/^[A-Za-z0-9_-]+$/)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CONNECTIVITY_DATE_MILLISECONDS)
  start?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CONNECTIVITY_DATE_MILLISECONDS)
  end?: number;
}
