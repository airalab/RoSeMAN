import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { type Response } from 'express';
import { DateRangeGuard } from '../common/guards/date-range.guard.js';
import { SensorJsonQueryDto } from './dto/sensor-json-query.dto.js';
import { SensorService } from './sensor.service.js';

/**
 * Контроллер для получения справочных данных по сенсорам.
 */
@Controller('sensor')
export class SensorController {
  constructor(private readonly sensorService: SensorService) {}

  /**
   * Возвращает список городов, сгруппированных по странам и регионам.
   * GET /api/sensor/cities
   */
  @Get('cities')
  async getCities(): Promise<{
    result: Record<string, Record<string, string[]>>;
  }> {
    const result = await this.sensorService.getCitiesGrouped();
    return { result };
  }

  /**
   * Возвращает данные сенсоров из указанной GPS-области или города
   * за временной диапазон, сгруппированные по sensor_id.
   * GET /api/sensor/json?start=...&end=...&bound=...|...  или  &city=...
   * @param query - query-параметры с обязательными start/end и одним из bound/city
   */
  @Get('json')
  @UseGuards(DateRangeGuard)
  async getSensorJson(
    @Query() query: SensorJsonQueryDto,
  ): Promise<{ result: Record<string, unknown> }> {
    if (!query.bound && !query.city) {
      throw new BadRequestException(
        'Either "bound" or "city" query parameter is required',
      );
    }

    const result = await this.sensorService.getSensorJson(
      query.start,
      query.end,
      { bound: query.bound, city: query.city },
    );

    return { result };
  }

  /**
   * Возвращает CSV-файл с данными сенсоров указанного города за период.
   * Разделитель — табуляция. Заголовки: timestamp, sensor_id, geo, pm10, pm25, ...
   * GET /api/sensor/csv/:start/:end/:city
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   * @param city - название города
   */
  @Get('csv/:start/:end/:city')
  @UseGuards(DateRangeGuard)
  async getSensorCsv(
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
    @Param('city') city: string,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.sensorService.getSensorCsv(city, start, end);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="sensors_${city}_${start}_${end}.csv"`,
    );
    res.send(csv);
  }

  /**
   * Возвращает уникальные типы измерений за указанный временной диапазон.
   * GET /api/sensor/measurements/:start/:end
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get('measurements/:start/:end')
  @UseGuards(DateRangeGuard)
  async getMeasurementTypes(
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{ result: string[] }> {
    const result = await this.sensorService.getMeasurementTypes(start, end);
    return { result };
  }

  /**
   * Возвращает сообщения (не сенсорные данные, model === MESSAGE)
   * за указанный временной диапазон.
   * GET /api/sensor/messages/:start/:end
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get('messages/:start/:end')
  @UseGuards(DateRangeGuard)
  async getMessages(
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{
    result: Array<{
      id: string;
      message: string;
      timestamp: number;
      geo: { lat: number; lng: number };
      author: string;
      images: string[];
    }>;
  }> {
    const result = await this.sensorService.getMessages(start, end);
    return { result };
  }

  /**
   * Возвращает данные конкретного сенсора за указанный временной диапазон.
   * GET /api/sensor/:sensor/:start/:end
   * @param sensor - идентификатор сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get(':sensor/:start/:end')
  @UseGuards(DateRangeGuard)
  async getSensorData(
    @Param('sensor') sensor: string,
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{ result: unknown[] }> {
    const result = await this.sensorService.getSensorData(sensor, start, end);
    return { result };
  }
}
