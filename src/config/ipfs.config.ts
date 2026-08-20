import { registerAs } from '@nestjs/config';

/** Максимальный размер IPFS-ответа по умолчанию: 10 МиБ. */
export const DEFAULT_IPFS_MAX_RESPONSE_BYTES = 10 * 1024 * 1024;

/**
 * Разбирает положительное целое число из переменной окружения.
 * @param raw - исходное строковое значение
 * @param fallback - значение при пустом или некорректном вводе
 * @returns положительное целое число
 */
function parsePositiveInteger(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default registerAs('ipfs', () => ({
  gateways: process.env.IPFS_GATEWAYS
    ? process.env.IPFS_GATEWAYS.split(',').map((g) => g.trim())
    : [
        'https://ipfs.io/ipfs/',
        'https://gateway.pinata.cloud/ipfs/',
        'https://cloudflare-ipfs.com/ipfs/',
      ],
  fetchTimeout: parseInt(process.env.IPFS_FETCH_TIMEOUT || '30000', 10),
  maxResponseBytes: parsePositiveInteger(
    process.env.IPFS_MAX_RESPONSE_BYTES,
    DEFAULT_IPFS_MAX_RESPONSE_BYTES,
  ),
  pollInterval: parseInt(process.env.IPFS_POLL_INTERVAL || '10000', 10),
  dirSender: process.env.IPFS_DIR_SENDER || '',
}));
