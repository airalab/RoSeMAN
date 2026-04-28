import {
  BadRequestException,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { DateRangeGuard } from '../common/guards/date-range.guard.js';
import { SensorService } from './sensor.service.js';

const TYPE_REGEX = /^[a-z0-9_]+$/;

/**
 * Контроллер для получения агрегированных данных сенсоров.
 */
@Controller('v2/sensor')
export class SensorV2Controller {
  constructor(private readonly sensorService: SensorService) {}

  /**
   * Возвращает максимальное значение измерения заданного типа
   * для каждого сенсора в указанном временном диапазоне.
   * GET /api/v2/sensor/maxdata/:type/:start/:end
   * @param type - тип измерения (`pm10`, `temperature` и т.д.)
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get('maxdata/:type/:start/:end')
  @UseGuards(DateRangeGuard)
  async getMaxData(
    @Param('type') type: string,
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{ result: Record<string, unknown> }> {
    if (!TYPE_REGEX.test(type)) {
      throw new BadRequestException(
        'Invalid type: only lowercase letters, digits and underscores are allowed',
      );
    }

    const result = await this.sensorService.getMaxData(type, start, end);
    return { result };
  }

  /**
   * Возвращает список сенсоров с данными в указанном временном диапазоне.
   * GET /api/v2/sensor/list/:start/:end
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get('list/:start/:end')
  @UseGuards(DateRangeGuard)
  async getSensorList(
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{ result: unknown[] }> {
    const result = await this.sensorService.getSensorList(start, end);
    return { result };
  }

  /**
   * Возвращает список сенсоров без измерений co2 в указанном временном диапазоне.
   * GET /api/v2/sensor/urban/:start/:end
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get('urban/:start/:end')
  @UseGuards(DateRangeGuard)
  async getUrbanSensorList(
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{ result: unknown[] }> {
    const result = await this.sensorService.getUrbanSensorList(start, end);
    return { result };
  }

  /**
   * Возвращает данные указанного сенсора за период,
   * а также данные всех сенсоров того же owner.
   * GET /api/v2/sensor/:sensor/:start/:end
   * @param sensor - идентификатор сенсора
   * @param start - начало диапазона (unix timestamp)
   * @param end - конец диапазона (unix timestamp)
   */
  @Get(':sensor/:start/:end')
  @UseGuards(DateRangeGuard)
  async getSensorDataWithOwner(
    @Param('sensor') sensor: string,
    @Param('start', ParseIntPipe) start: number,
    @Param('end', ParseIntPipe) end: number,
  ): Promise<{
    result: unknown[];
    sensor: unknown;
  }> {
    return this.sensorService.getSensorDataWithOwner(sensor, start, end);
  }
}
