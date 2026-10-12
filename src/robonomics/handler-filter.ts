import { Logger } from '@nestjs/common';

const logger = new Logger('HandlerFilter');
const LEGACY_HANDLER_NAMES = new Set([
  'datalog-new-record',
  'rws-new-devices',
  'rws-extrinsic',
  'rws-story',
]);

/**
 * Парсит env-переменную в Set имён хендлеров.
 * Пустая/отсутствующая переменная → null (фильтр неактивен).
 * @param value - значение env-переменной (строка через запятую)
 */
function parseList(value: string | undefined): Set<string> | null {
  if (!value) return null;
  const items = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length > 0 ? new Set(items) : null;
}

/**
 * Фильтрует массив хендлеров на основе env-переменных:
 * - `ENABLED_HANDLERS` (allowlist) — если задан, включает только перечисленные;
 * - `DISABLED_HANDLERS` (denylist) — исключает перечисленные.
 *
 * Если обе переменные не заданы — возвращается исходный массив.
 * Если заданы обе — allowlist имеет приоритет, denylist применяется поверх.
 *
 * @param handlers - массив хендлеров с полем `name`
 * @param kind - метка для логирования ('event' | 'extrinsic')
 */
export function filterHandlers<T extends { name: string }>(
  handlers: T[],
  kind: 'event' | 'extrinsic',
): T[] {
  const enabled = parseList(process.env.ENABLED_HANDLERS);
  const disabled = parseList(process.env.DISABLED_HANDLERS);

  const filtered =
    enabled || disabled
      ? handlers.filter((handler) => {
          if (enabled && !enabled.has(handler.name)) return false;
          if (disabled && disabled.has(handler.name)) return false;
          return true;
        })
      : handlers;

  if (enabled || disabled) {
    const activeNames = filtered.map((handler) => handler.name).join(', ');
    logger.log(`Active ${kind} handlers: ${activeNames || '(none)'}`);
  }

  const activeLegacyNames = filtered
    .map((handler) => handler.name)
    .filter((name) => LEGACY_HANDLER_NAMES.has(name));
  if (activeLegacyNames.length > 0) {
    logger.warn(
      `Deprecated legacy ${kind} handlers are active: ${activeLegacyNames.join(', ')}`,
    );
  }

  return filtered;
}
