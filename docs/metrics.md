# Metrics

RoSeMAN exports metrics in Prometheus format on the **`/metrics`** endpoint (without the `/api` prefix). Metrics are served only when the REST API is enabled (`API_ENABLED !== 'false'`) — `MetricsModule` and `PrometheusModule` are wired into `AppModule` under the same flag.

## PrometheusModule

In `app.module.ts`:

```ts
PrometheusModule.register({
  defaultMetrics: { enabled: false }, // default Node.js metrics are disabled
  path: '/metrics',
})
```

Default Node.js metrics (`process_cpu_seconds_total`, `nodejs_eventloop_lag_seconds`, etc.) are deliberately turned off — only the application's business signals are exported.

## Exported gauges

| Metric                    | Type  | Labels    | Description                                      |
|---------------------------|-------|-----------|--------------------------------------------------|
| `roseman_block_read`      | gauge | `chain`   | Number of the last processed block for each `index_state` key (`polkadot_robonomics`, `kusama_robonomics`, …) |
| `roseman_ipfs_queue`      | gauge | —         | Count of `datalogs` records with status `IPFS_PENDING` (unprocessed IPFS CIDs)            |

## Exported CPS counters

| Metric                                      | Type    | Description                                                        |
| ------------------------------------------- | ------- | ------------------------------------------------------------------ |
| `roseman_cps_raw_payload_bytes_total`       | counter | Raw payload bytes belonging to completed anchors                   |
| `roseman_cps_stored_records_total`          | counter | Canonical records belonging to completed anchors                   |
| `roseman_cps_invalid_signatures_total`      | counter | Invalid signatures in completed anchors                            |
| `roseman_cps_unsupported_messages_total`    | counter | Unsupported protocol messages in completed anchors                 |
| `roseman_cps_private_sections_total`        | counter | Encrypted private sections in completed anchors                    |
| `roseman_cps_projection_errors_total`       | counter | Records affected by failed legacy-projection attempts              |

Completed-anchor counters are incremented only after the final anchor status is persisted. A retry therefore does not count the same successful anchor twice. Projection errors describe failed attempts and may increase again if a later retry fails at the same boundary.

These counters are process-local and reset when the process restarts; they are not reconstructed from MongoDB. Raw bytes are counted only when `CPS_RAW_PAYLOAD_STORAGE_ENABLED=true`, and canonical records only when `CPS_CANONICAL_STORAGE_ENABLED=true`.

## MetricsService

File: `src/metrics/metrics.service.ts`. Gauge values come from the DB:

1. On `onModuleInit` it starts a periodic `syncMetric()` loop via `setTimeout(5000)`.
2. Each tick:
   - `DatalogRepository.getCountIpfsPending()` → `roseman_ipfs_queue.set(count)`.
   - `IndexStateRepository.getAllIndex()` → for each record `roseman_block_read.set({ chain: key }, value)`.
3. The next tick is scheduled **only after the current one completes** (`scheduleNext()` in `finally`) — this prevents slow queries from overlapping.
4. On `onModuleDestroy` the loop is stopped (`isRunning = false`, `clearTimeout`).

DB read errors are swallowed (`try/catch { /* ignore */ }`) — metrics are exported on a best-effort basis and must not bring the application down.

## Usage

Prometheus scraping:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: roseman
    metrics_path: /metrics
    static_configs:
      - targets: ['roseman-api:3000']
```

Useful queries:

| Query (PromQL)                                                  | What it shows                                            |
|-----------------------------------------------------------------|----------------------------------------------------------|
| `roseman_block_read{chain="polkadot_robonomics"}`               | Current progress of the Polkadot indexer                 |
| `rate(roseman_block_read{chain="kusama_robonomics"}[5m])`       | Block processing rate of the Kusama indexer (blocks/sec) |
| `roseman_ipfs_queue`                                            | Size of the unprocessed IPFS-CID queue (growth = problem) |
| `delta(roseman_ipfs_queue[10m])`                                | Queue change over 10 minutes                             |

## When metrics "don't show up"

- `API_ENABLED=false` → `/metrics` is not started (this is headless mode).
- `INDEXER_ENABLED=false` or `MEASUREMENT_ENABLED=false` on this instance → DB-backed gauges are still exported, but process-local CPS counters do not change.
- If indexers run on dedicated headless processes and the REST API runs on a separate instance, the API instance can still expose the DB-backed gauges. CPS counters are visible only from a process that runs both the measurement worker and `/metrics`; a headless worker currently has no Prometheus endpoint.

## Extending

To add a new metric:

1. Register `makeGaugeProvider({ name, help, labelNames })` in `src/metrics/metrics.module.ts`.
2. Inject it into `MetricsService` or a focused service such as `CpsMetricsService` via `@InjectMetric('<name>')`.
3. Update a gauge in `syncMetric()` or increment a counter only after the corresponding operation has reached its durable boundary.

For counters and histograms use `makeCounterProvider` and `makeHistogramProvider` from the same `@willsoto/nestjs-prometheus`.
