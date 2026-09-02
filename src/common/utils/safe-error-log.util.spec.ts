import { formatSafeErrorForLog } from './safe-error-log.util.js';

describe('formatSafeErrorForLog', () => {
  it('оставляет только имя класса и стабильный код', () => {
    const secrets = [
      'raw-payload-010203',
      'signature-aabbcc',
      'nonce-ddeeff',
      'public-key-112233',
      'ciphertext-445566',
    ];
    const error = new Error(secrets.join(' ')) as Error & {
      code: string;
      rawPayload: Uint8Array;
    };
    error.name = 'ProtocolStorageError';
    error.code = 'WRITE_FAILED';
    error.stack = `stack ${secrets.join(' ')}`;
    error.cause = new Error(secrets.join(' '));
    error.rawPayload = Uint8Array.from([1, 2, 3]);

    const result = formatSafeErrorForLog(error);

    expect(result).toBe('ProtocolStorageError [code=WRITE_FAILED]');
    for (const secret of secrets) expect(result).not.toContain(secret);
  });

  it('отбрасывает произвольные name и code недоверенного объекта', () => {
    const error = new Error('ciphertext');
    error.name = 'public-key-content';
    Object.assign(error, { code: 'nonce-content' });

    expect(formatSafeErrorForLog(error)).toBe('Error');
    expect(formatSafeErrorForLog('raw payload')).toBe('UnknownError');
  });

  it('сохраняет безопасный числовой код ошибки', () => {
    const error = Object.assign(new RangeError('sensitive message'), {
      code: 11000,
    });

    expect(formatSafeErrorForLog(error)).toBe('RangeError [code=11000]');
  });
});
