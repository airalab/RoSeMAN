/** Отдельное состояние canonical backfill, не меняющее ingestion queue. */
export enum CpsBackfillStatus {
  Processing = 'processing',
  Processed = 'processed',
  ProcessedWithErrors = 'processed_with_errors',
  Error = 'error',
}
