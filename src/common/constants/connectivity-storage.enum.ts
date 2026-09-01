/** Тип источника канонических данных Connectivity Protocol. */
export enum ConnectivitySourceType {
  Cps = 'cps',
}

/** Явно заданный wire format transport payload. */
export enum ProtocolBatchWireFormat {
  Raw = 'raw',
  Xz = 'xz',
  Zlib = 'zlib',
}

/** Состояние декодирования исходного transport payload. */
export enum ConnectivityPayloadDecodeStatus {
  Pending = 'pending',
  Decoded = 'decoded',
  DecodedWithErrors = 'decoded_with_errors',
  Error = 'error',
}

/** Результат структурной проверки envelope. */
export enum ConnectivityStructureStatus {
  Valid = 'valid',
  Invalid = 'invalid',
}

/** Результат криптографической проверки envelope. */
export enum ConnectivitySignatureStatus {
  Pending = 'pending',
  Valid = 'valid',
  Invalid = 'invalid',
  NotChecked = 'not_checked',
}

/** Состояние декодирования вложенного protocol message. */
export enum ConnectivityRecordDecodeStatus {
  Pending = 'pending',
  Decoded = 'decoded',
  Unsupported = 'unsupported',
  Error = 'error',
  NotAttempted = 'not_attempted',
}

/** Состояние совместимой проекции в коллекцию measurements. */
export enum ConnectivityLegacyProjectionStatus {
  Pending = 'pending',
  Projected = 'projected',
  Skipped = 'skipped',
  Error = 'error',
  NotAttempted = 'not_attempted',
}

/** Поддерживаемый тип payload корневого protocol message. */
export enum ConnectivityPayloadType {
  Urban = 'urban',
  Insight = 'insight',
  Unknown = 'unknown',
}
