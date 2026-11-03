import type { NextFunction, Request, Response } from 'express';

export const DATA_LICENSE_ID = 'ODbL-1.0';
export const DATA_LICENSE_URL =
  'https://opendatacommons.org/licenses/odbl/1-0/';
export const DATA_ATTRIBUTION = 'sensors.social contributors';

/**
 * Дописывает значение к заголовку, не затирая уже установленные значения.
 * @param response - HTTP-ответ Express
 * @param name - имя заголовка
 * @param value - добавляемое значение
 * @param separator - разделитель значений
 */
export function appendHeaderValue(
  response: Response,
  name: string,
  value: string,
  separator = ', ',
): void {
  const current = response.getHeader(name);
  const values = (Array.isArray(current) ? current : [current])
    .map((item) => (item === undefined ? '' : String(item).trim()))
    .filter(Boolean);
  if (!values.includes(value)) values.push(value);
  response.setHeader(name, values.join(separator));
}

/**
 * Помечает ответы API лицензией открытых данных (ODbL 1.0) без изменения
 * тела ответа: Link с rel="license" (RFC 8288) и явные X-Data-* заголовки.
 */
export function dataLicenseHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  appendHeaderValue(response, 'Link', `<${DATA_LICENSE_URL}>; rel="license"`);
  response.setHeader('X-Data-License', DATA_LICENSE_ID);
  response.setHeader('X-Data-Attribution', DATA_ATTRIBUTION);
  appendHeaderValue(response, 'Access-Control-Expose-Headers', 'Link');
  appendHeaderValue(
    response,
    'Access-Control-Expose-Headers',
    'X-Data-License',
  );
  appendHeaderValue(
    response,
    'Access-Control-Expose-Headers',
    'X-Data-Attribution',
  );
  next();
}
