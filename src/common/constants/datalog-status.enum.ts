/**
 * Статус записи устаревшей очереди datalogs.
 * @deprecated Новая индексация использует состояния CpsAnchorStatus.
 */
export enum DatalogStatus {
  NEW = 0,
  IPFS_PENDING = 1,
  PROCESSED = 2,
  ERROR = 3,
}
