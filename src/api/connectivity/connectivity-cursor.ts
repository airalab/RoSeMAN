import { Types } from 'mongoose';

const CURSOR_VERSION = 2;
const CURSOR_BYTE_LENGTH = 21;
const CURSOR_ENCODED_LENGTH = 28;
const TIMESTAMP_OFFSET = 1;
const OBJECT_ID_OFFSET = 9;
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const CURSOR_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface ConnectivityCursorPosition {
  readonly recordedAt: Date;
  readonly recordId: Types.ObjectId;
}

/** Ошибка разбора недоверенного cursor без включения его содержимого. */
export class InvalidConnectivityCursorError extends Error {
  /** Создаёт стабильную ошибку неверного cursor. */
  constructor() {
    super('Invalid connectivity cursor');
    this.name = InvalidConnectivityCursorError.name;
  }
}

/**
 * Кодирует позицию последней записи в непрозрачный URL-safe cursor.
 * @param position - timestamp и MongoDB ObjectId последней записи страницы
 * @returns бинарный base64url cursor фиксированной длины
 */
export function encodeConnectivityCursor(
  position: ConnectivityCursorPosition,
): string {
  const timestamp = position.recordedAt.getTime();
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    timestamp > MAX_DATE_MILLISECONDS
  ) {
    throw new InvalidConnectivityCursorError();
  }

  const payload = Buffer.allocUnsafe(CURSOR_BYTE_LENGTH);
  payload.writeUInt8(CURSOR_VERSION, 0);
  payload.writeBigInt64BE(BigInt(timestamp), TIMESTAMP_OFFSET);
  Buffer.from(position.recordId.id).copy(payload, OBJECT_ID_OFFSET);
  return payload.toString('base64url');
}

/**
 * Проверяет и декодирует недоверенный cursor.
 * @param cursor - base64url cursor из query
 * @returns проверенная позиция стабильной сортировки
 */
export function decodeConnectivityCursor(
  cursor: string,
): ConnectivityCursorPosition {
  try {
    if (
      cursor.length !== CURSOR_ENCODED_LENGTH ||
      !CURSOR_PATTERN.test(cursor)
    ) {
      throw new InvalidConnectivityCursorError();
    }
    const decoded = Buffer.from(cursor, 'base64url');
    if (
      decoded.length !== CURSOR_BYTE_LENGTH ||
      decoded.toString('base64url') !== cursor ||
      decoded.readUInt8(0) !== CURSOR_VERSION
    ) {
      throw new InvalidConnectivityCursorError();
    }
    const timestamp = Number(decoded.readBigInt64BE(TIMESTAMP_OFFSET));
    if (
      !Number.isSafeInteger(timestamp) ||
      timestamp < 0 ||
      timestamp > MAX_DATE_MILLISECONDS
    ) {
      throw new InvalidConnectivityCursorError();
    }
    return {
      recordedAt: new Date(timestamp),
      recordId: new Types.ObjectId(decoded.subarray(OBJECT_ID_OFFSET)),
    };
  } catch (error) {
    if (error instanceof InvalidConnectivityCursorError) throw error;
    throw new InvalidConnectivityCursorError();
  }
}
