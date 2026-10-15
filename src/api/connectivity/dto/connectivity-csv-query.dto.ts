import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_CONNECTIVITY_DATE_MILLISECONDS } from './connectivity-message-filter-query.dto.js';

/** Query-параметры экспорта CPS-сообщений в совместимый CSV. */
export class ConnectivityCsvQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CONNECTIVITY_DATE_MILLISECONDS)
  start!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_CONNECTIVITY_DATE_MILLISECONDS)
  end!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  city!: string;
}
