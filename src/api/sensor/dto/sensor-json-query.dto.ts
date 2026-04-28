import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class GeoBound {
  south!: number;
  west!: number;
  north!: number;
  east!: number;
}

/**
 * Парсит строку bound формата "lat1,lng1|lat2,lng2" в объект GeoBound.
 * Первая точка — юго-западный угол, вторая — северо-восточный.
 */
function parseBound(value: string): GeoBound {
  const parts = value.split('|');
  if (parts.length !== 2) {
    throw new BadRequestException(
      'bound must be in format "lat1,lng1|lat2,lng2"',
    );
  }

  const [first, second] = parts.map((p) => p.split(',').map(Number));

  if (
    first.length !== 2 ||
    second.length !== 2 ||
    first.some(isNaN) ||
    second.some(isNaN)
  ) {
    throw new BadRequestException(
      'bound must contain valid numeric coordinates',
    );
  }

  return {
    south: Math.min(first[0], second[0]),
    west: Math.min(first[1], second[1]),
    north: Math.max(first[0], second[0]),
    east: Math.max(first[1], second[1]),
  };
}

/**
 * DTO для query-параметров эндпоинта GET /api/sensor/json.
 * Обязательны start и end (unix timestamp).
 * Необходим хотя бы один из параметров: bound или city.
 */
export class SensorJsonQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  start!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  end!: number;

  @IsOptional()
  @ValidateNested()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? parseBound(value) : value,
  )
  bound?: GeoBound;

  @IsOptional()
  @IsString()
  @ValidateIf((o: SensorJsonQueryDto) => !o.bound)
  city?: string;
}
