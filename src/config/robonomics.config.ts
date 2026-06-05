import { registerAs } from '@nestjs/config';

/** Специальное значение startBlock — начать индексацию с текущего блока в чейне. */
export const START_BLOCK_LATEST = 'latest';

/**
 * Разбирает значение ROBONOMICS_START_BLOCK.
 * Возвращает номер блока либо `'latest'`, если переменная не задана,
 * равна `'latest'` или содержит некорректное число.
 * @param raw - сырое значение переменной окружения
 * @returns номер стартового блока или `'latest'`
 */
function parseStartBlock(
  raw: string | undefined,
): number | typeof START_BLOCK_LATEST {
  if (!raw || raw.trim().toLowerCase() === START_BLOCK_LATEST) {
    return START_BLOCK_LATEST;
  }
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? START_BLOCK_LATEST : parsed;
}

export default registerAs('robonomics', () => ({
  wsEndpoint:
    process.env.ROBONOMICS_WS || 'wss://polkadot.rpc.robonomics.network',
  startBlock: parseStartBlock(process.env.ROBONOMICS_START_BLOCK),
  startBlockForce: process.env.ROBONOMICS_START_BLOCK_FORCE === 'true',
  stateKey: process.env.ROBONOMICS_STATE_KEY || 'polkadot_robonomics',
  accounts: process.env.ROBONOMICS_ACCOUNTS
    ? process.env.ROBONOMICS_ACCOUNTS.split(',').map((a) => a.trim())
    : [],
}));
