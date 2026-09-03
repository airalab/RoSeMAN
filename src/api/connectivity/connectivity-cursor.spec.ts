import { Types } from 'mongoose';
import {
  decodeConnectivityCursor,
  encodeConnectivityCursor,
  InvalidConnectivityCursorError,
} from './connectivity-cursor.js';

describe('connectivity cursor', () => {
  it('без потери восстанавливает millisecond timestamp и ObjectId', () => {
    const position = {
      recordedAt: new Date('2026-09-03T10:11:12.345Z'),
      recordId: new Types.ObjectId('68b95ae07796696240566a01'),
    };

    const cursor = encodeConnectivityCursor(position);

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cursor).toHaveLength(28);
    expect(decodeConnectivityCursor(cursor)).toEqual(position);
  });

  it.each([
    '',
    'not+base64',
    Buffer.from('{}').toString('base64url'),
    Buffer.alloc(21).toString('base64url'),
    (() => {
      const payload = Buffer.alloc(21);
      payload.writeUInt8(2, 0);
      payload.writeBigInt64BE(BigInt(Number.MAX_SAFE_INTEGER), 1);
      return payload.toString('base64url');
    })(),
  ])('отклоняет неверный cursor без возврата его содержимого', (cursor) => {
    expect(() => decodeConnectivityCursor(cursor)).toThrow(
      InvalidConnectivityCursorError,
    );
  });
});
