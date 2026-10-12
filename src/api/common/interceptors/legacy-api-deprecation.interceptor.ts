import {
  applyDecorators,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';

export const LEGACY_API_DEPRECATION_DATE = '@1791763200';
export const LEGACY_API_DEPRECATION_DOCUMENT =
  'https://github.com/airalab/RoSeMAN/blob/master/docs/legacy-deprecation.md';

/**
 * Добавляет значение в Access-Control-Expose-Headers без удаления уже
 * настроенных заголовков ответа.
 * @param response - HTTP-ответ Express
 * @param headerNames - имена заголовков, которые должны быть доступны браузеру
 */
function exposeHeaders(response: Response, headerNames: string[]): void {
  const current = response.getHeader('Access-Control-Expose-Headers');
  const values = new Set(
    (Array.isArray(current) ? current : String(current ?? '').split(','))
      .map((value) => String(value).trim())
      .filter(Boolean),
  );

  for (const headerName of headerNames) values.add(headerName);
  response.setHeader(
    'Access-Control-Expose-Headers',
    Array.from(values).join(', '),
  );
}

/**
 * Помечает HTTP-ответ как относящийся к устаревшему API без изменения тела
 * ответа или статуса согласно RFC 9745.
 */
@Injectable()
export class LegacyApiDeprecationInterceptor implements NestInterceptor {
  /**
   * Устанавливает дату депрекации и ссылку на руководство по миграции.
   * @param context - контекст текущего HTTP-запроса
   * @param next - следующий обработчик NestJS
   * @returns поток исходного ответа контроллера
   */
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();
    response.setHeader('Deprecation', LEGACY_API_DEPRECATION_DATE);
    response.setHeader(
      'Link',
      `<${LEGACY_API_DEPRECATION_DOCUMENT}>; rel="deprecation"`,
    );
    exposeHeaders(response, ['Deprecation', 'Link']);
    return next.handle();
  }
}

/**
 * Подключает мягкую HTTP-депрекацию к контроллеру или отдельному маршруту.
 * @returns составной декоратор NestJS
 */
export function DeprecatedApi(): ClassDecorator & MethodDecorator {
  return applyDecorators(UseInterceptors(LegacyApiDeprecationInterceptor));
}
