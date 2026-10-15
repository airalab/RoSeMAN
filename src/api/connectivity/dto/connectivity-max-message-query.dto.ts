import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Max, Min } from 'class-validator';
import {
  ConnectivityMessageBaseFilterQueryDto,
  MAX_CONNECTIVITY_DATE_MILLISECONDS,
} from './connectivity-message-filter-query.dto.js';

/** Query DTO максимальных сообщений сенсоров в обязательном диапазоне дат. */
export class ConnectivityMaxMessageQueryDto extends ConnectivityMessageBaseFilterQueryDto {
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
  type!: string;
}
