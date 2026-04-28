import { Logger } from '@nestjs/common';

const logger = new Logger('HandlerFilter');

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

  if (!enabled && !disabled) return handlers;

  const filtered = handlers.filter((h) => {
    if (enabled && !enabled.has(h.name)) return false;
    if (disabled && disabled.has(h.name)) return false;
    return true;
  });

  const activeNames = filtered.map((h) => h.name).join(', ') || '(none)';
  logger.log(`Active ${kind} handlers: ${activeNames}`);

  return filtered;
}
