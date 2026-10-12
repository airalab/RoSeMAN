import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

const MAX_LIMIT = 50;

/**
 * DTO для query-параметров эндпоинта GET /api/v2/story/list.
 * Все параметры опциональны.
 * @deprecated Актуальный CPS API не использует stories.
 */
export class StoryListQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_LIMIT)
  limit: number = MAX_LIMIT;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  start?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  end?: number;
}
