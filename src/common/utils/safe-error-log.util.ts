const SAFE_ERROR_NAME_PATTERN = /^(?:Error|[A-Za-z][A-Za-z0-9]{0,55}Error)$/;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Формирует безопасное описание ошибки без message, stack, cause и данных объекта.
 * @param error - недоверенная ошибка внешнего или внутреннего компонента
 * @returns имя класса и необязательный стабильный машинный код
 */
export function formatSafeErrorForLog(error: unknown): string {
  const name = readSafeErrorName(error);
  const code = readSafeErrorCode(error);
  return code ? `${name} [code=${code}]` : name;
}

/**
 * Возвращает только безопасное имя класса ошибки.
 * @param error - недоверенная ошибка
 * @returns проверенное имя либо общий маркер
 */
function readSafeErrorName(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  try {
    return SAFE_ERROR_NAME_PATTERN.test(error.name) ? error.name : 'Error';
  } catch {
    return 'Error';
  }
}

/**
 * Извлекает только короткий символический или числовой код ошибки.
 * @param error - недоверенная ошибка
 * @returns безопасный код либо `undefined`
 */
function readSafeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    if (!('code' in error)) return undefined;
    const code = error.code;
    if (typeof code === 'string' && SAFE_ERROR_CODE_PATTERN.test(code)) {
      return code;
    }
    if (typeof code === 'number' && Number.isSafeInteger(code)) {
      return String(code);
    }
  } catch {
    return undefined;
  }
  return undefined;
}
