import {
  CanActivate,
  ExecutionContext,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

const SECONDS_PER_DAY = 86_400;

/**
 * Guard для проверки что временной диапазон (start/end)
 * в route-параметрах не превышает допустимый период.
 * Ожидает наличие параметров :start и :end (unix timestamp в секундах).
 */
@Injectable()
export class DateRangeGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const start = Number(request.params.start ?? request.query.start);
    const end = Number(request.params.end ?? request.query.end);
    const maxDays = this.config.get<number>('app.maxPeriodDays', 31);

    if (end - start > maxDays * SECONDS_PER_DAY) {
      throw new PayloadTooLargeException(`Max period ${maxDays} days`);
    }

    return true;
  }
}
