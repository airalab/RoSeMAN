/**
 * Состояние элемента очереди CPS anchor.
 */
export enum CpsAnchorStatus {
  PENDING = 0,
  PROCESSING = 1,
  PROCESSED = 2,
  PROCESSED_WITH_ERRORS = 3,
  RETRY_PENDING = 4,
  ERROR = 5,
}
