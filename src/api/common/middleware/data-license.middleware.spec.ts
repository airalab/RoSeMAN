import type { Request, Response } from 'express';
import {
  DATA_ATTRIBUTION,
  DATA_LICENSE_ID,
  DATA_LICENSE_URL,
  dataLicenseHeaders,
} from './data-license.middleware.js';

describe('dataLicenseHeaders', () => {
  /** Минимальный HTTP-ответ с хранением заголовков в Map. */
  function createResponse(initial: [string, string][] = []): {
    response: Response;
    headers: Map<string, string | string[]>;
  } {
    const headers = new Map<string, string | string[]>(initial);
    const response = {
      getHeader: jest.fn((name: string) => headers.get(name)),
      setHeader: jest.fn((name: string, value: string | string[]) => {
        headers.set(name, value);
      }),
    } as unknown as Response;
    return { response, headers };
  }

  it('добавляет лицензию данных и вызывает next', () => {
    const { response, headers } = createResponse();
    const next = jest.fn();

    dataLicenseHeaders({} as Request, response, next);

    expect(headers.get('Link')).toBe(`<${DATA_LICENSE_URL}>; rel="license"`);
    expect(headers.get('X-Data-License')).toBe(DATA_LICENSE_ID);
    expect(headers.get('X-Data-Attribution')).toBe(DATA_ATTRIBUTION);
    expect(headers.get('Access-Control-Expose-Headers')).toBe(
      'Link, X-Data-License, X-Data-Attribution',
    );
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('сохраняет уже установленные Link и expose-заголовки', () => {
    const { response, headers } = createResponse([
      ['Link', '<https://example.com>; rel="deprecation"'],
      ['Access-Control-Expose-Headers', 'X-Next-Cursor'],
    ]);

    dataLicenseHeaders({} as Request, response, jest.fn());

    expect(headers.get('Link')).toBe(
      `<https://example.com>; rel="deprecation", <${DATA_LICENSE_URL}>; rel="license"`,
    );
    expect(headers.get('Access-Control-Expose-Headers')).toBe(
      'X-Next-Cursor, Link, X-Data-License, X-Data-Attribution',
    );
  });
});
