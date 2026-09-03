import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import {
  ConnectivityMessageFilterQueryDto,
  MAX_CONNECTIVITY_DATE_MILLISECONDS,
} from './connectivity-message-filter-query.dto.js';

/** Query DTO последних сообщений сенсоров в обязательном диапазоне дат. */
export class ConnectivityLatestMessageQueryDto extends ConnectivityMessageFilterQueryDto {
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
}
