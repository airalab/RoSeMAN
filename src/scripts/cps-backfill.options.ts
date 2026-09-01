import type { CpsBackfillOptions } from '../measurement/cps-backfill.service.js';

const DEFAULT_BACKFILL_LIMIT = 100;

/**
 * Разбирает аргументы maintenance CLI без неявных значений окружения.
 * @param args - аргументы после имени Node.js entry point
 * @returns проверенные опции одного ограниченного запуска
 */
export function parseCpsBackfillOptions(
  args: readonly string[],
): CpsBackfillOptions {
  const options: {
    dryRun: boolean;
    startBlock?: number;
    endBlock?: number;
    cid?: string;
    limit: number;
    includeCompleted?: boolean;
  } = { dryRun: false, limit: DEFAULT_BACKFILL_LIMIT };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (argument === '--force') {
      options.includeCompleted = true;
      continue;
    }
    const [name, inlineValue] = argument.split('=', 2);
    if (!['--start-block', '--end-block', '--cid', '--limit'].includes(name)) {
      throw new Error(`Unknown CPS backfill argument: ${argument}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for CPS backfill argument: ${name}`);
    }
    if (inlineValue === undefined) index += 1;

    if (name === '--cid') {
      options.cid = value;
      continue;
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
      throw new Error(`${name} must be a safe unsigned integer`);
    }
    if (name === '--start-block') options.startBlock = parsed;
    if (name === '--end-block') options.endBlock = parsed;
    if (name === '--limit') {
      if (parsed === 0) throw new Error('--limit must be greater than zero');
      options.limit = parsed;
    }
  }

  if (
    options.startBlock !== undefined &&
    options.endBlock !== undefined &&
    options.startBlock > options.endBlock
  ) {
    throw new Error('--start-block must not exceed --end-block');
  }
  return options;
}
