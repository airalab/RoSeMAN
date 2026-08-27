# RoSeMAN documentation

**Ro**obonomics **Se**ensors **M**easure Analytics and **A**rchive **N**ode — indexer for legacy `datalog`/`rws` data and the CPS protocol of the Robonomics parachain, with verified IPFS ingestion and a REST API on top of the collected measurements.

The documentation covers every project component: blockchain indexer, IPFS processing, geocoding, REST API, metrics and deployment.

## Contents

### Getting started

- **[Architecture](./architecture.md)** — project modules, run modes (full / headless / indexer), `.env` loading cascade, data flow between services.
- **[Deployment](./deployment.md)** — local launch, Docker Compose, multi-instance configuration (Polkadot + Kusama + REST API on a single DB).

### Services

- **[Indexer](./indexer.md)** — `BlockIndexerService` (catch-up + sequential realtime queue + reconnect), legacy and CPS handlers, CPS snapshot, both IPFS processors, protocol verification, geocoding, MongoDB schemas and configuration.

### REST API

- **[REST API design](./api.md)** — global prefix, CORS, validation (`ValidationPipe` + DTO), error handling (`AllExceptionsFilter`), `DateRangeGuard`, response format, versioning (V1/V2).
- **[Endpoint reference](./api_endpoints.md)** — full reference of all REST endpoints with parameters and descriptions.

### Data

- **[Database](./database.md)** — Repository pattern, overview of every repository and its responsibilities, links to collection schemas.

### Operations

- **[Metrics](./metrics.md)** — Prometheus `/metrics` endpoint, exported gauges, `MetricsService` and integration with monitoring.

## Quick topic navigation

| Topic                                      | Where to look                                          |
|--------------------------------------------|--------------------------------------------------------|
| Robonomics connection, reconnect           | [indexer.md → RobonomicsService](./indexer.md#robonomicsservice) |
| Catch-up + realtime block scanning         | [indexer.md → BlockIndexerService](./indexer.md#blockindexerservice) |
| Event and extrinsic handlers               | [indexer.md → Handlers](./indexer.md#handlers)          |
| Legacy IPFS JSON processing                | [indexer.md → MeasurementProcessorService](./indexer.md#measurementprocessorservice) |
| CPS snapshot, events and processing         | [indexer.md → CPS ingestion](./indexer.md#cps-ingestion) |
| IPFS fetch, gateway fallback                | [indexer.md → IpfsFetcherService](./indexer.md#ipfsfetcherservice) |
| Reverse geocoding (Nominatim)              | [indexer.md → GeocodingService](./indexer.md#geocodingservice) |
| MongoDB schemas and indexes                | [indexer.md → MongoDB schemas](./indexer.md#mongodb-schemas) |
| Full list of environment variables         | [indexer.md → Configuration](./indexer.md#configuration) |
| REST controllers, versioning, format       | [api.md](./api.md)                                      |
| A specific endpoint                        | [api_endpoints.md](./api_endpoints.md)                  |
| Repository pattern, DB access              | [database.md](./database.md)                            |
| `roseman_block_read`, `roseman_ipfs_queue` | [metrics.md](./metrics.md)                              |
| Running Polkadot + Kusama at once          | [deployment.md → Multi-instance](./deployment.md#multi-instance-deployment) |

## Stack

- **NestJS 11** + TypeScript (ESM)
- **MongoDB** via **Mongoose 7** (Repository pattern)
- **@polkadot/api** + `robonomics-api-augment`
- **@willsoto/nestjs-prometheus** / `prom-client`
- **Buf Protobuf**, **@polkadot/util-crypto** and **lzma-native** — CPS decode, Ed25519 verification and XZ/LZMA2
- **iconv-lite** — payload decoding for arbitrary encodings
- ESLint + Prettier
