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

## MetricsService

File: `src/metrics/metrics.service.ts`. The values come from the DB, not from in-memory counters:

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
- `INDEXER_ENABLED=false` or `MEASUREMENT_ENABLED=false` on this instance → metrics are still exported, but the values reflect the DB state, not this process's activity. In other words, the metrics describe the **global state of data**, not the local load.
- If indexers run on dedicated headless processes and the REST API runs on a third one, then it's that REST API instance that serves `/metrics` for the whole installation. This is fine: the gauges read the DB.

## Extending

To add a new metric:

1. Register `makeGaugeProvider({ name, help, labelNames })` in `src/metrics/metrics.module.ts`.
2. Inject it into `MetricsService` via `@InjectMetric('<name>')`.
3. Update the value in `syncMetric()` (or in a reactive source — for example, in the repository on insert/update).

For counters and histograms use `makeCounterProvider` and `makeHistogramProvider` from the same `@willsoto/nestjs-prometheus`.
