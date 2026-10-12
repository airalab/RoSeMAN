import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Response } from 'express';
import { of } from 'rxjs';
import {
  LEGACY_API_DEPRECATION_DATE,
  LEGACY_API_DEPRECATION_DOCUMENT,
  LegacyApiDeprecationInterceptor,
} from './legacy-api-deprecation.interceptor.js';

describe('LegacyApiDeprecationInterceptor', () => {
  /** Создаёт минимальный HTTP-контекст для проверки interceptor. */
  function createContext(response: Response): ExecutionContext {
    return {
      switchToHttp: () =>
        ({ getResponse: () => response }) as ReturnType<
          ExecutionContext['switchToHttp']
        >,
    } as ExecutionContext;
  }

  it('добавляет стандартные заголовки депрекации', () => {
    const headers = new Map<string, string | string[]>();
    const response = {
      getHeader: jest.fn((name: string) => headers.get(name)),
      setHeader: jest.fn((name: string, value: string | string[]) => {
        headers.set(name, value);
      }),
    } as unknown as Response;
    const handle = jest.fn(() => of('ok'));
    const next = { handle } as CallHandler;

    new LegacyApiDeprecationInterceptor().intercept(
      createContext(response),
      next,
    );

    expect(headers.get('Deprecation')).toBe(LEGACY_API_DEPRECATION_DATE);
    expect(headers.get('Link')).toBe(
      `<${LEGACY_API_DEPRECATION_DOCUMENT}>; rel="deprecation"`,
    );
    expect(headers.get('Access-Control-Expose-Headers')).toBe(
      'Deprecation, Link',
    );
    expect(handle).toHaveBeenCalledTimes(1);
  });

  it('сохраняет ранее открытые CORS-заголовки без дубликатов', () => {
    const headers = new Map<string, string | string[]>([
      ['Access-Control-Expose-Headers', 'X-Next-Cursor, Deprecation'],
    ]);
    const response = {
      getHeader: jest.fn((name: string) => headers.get(name)),
      setHeader: jest.fn((name: string, value: string | string[]) => {
        headers.set(name, value);
      }),
    } as unknown as Response;

    new LegacyApiDeprecationInterceptor().intercept(createContext(response), {
      handle: () => of('ok'),
    } as CallHandler);

    expect(headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Next-Cursor, Deprecation, Link',
    );
  });
});
