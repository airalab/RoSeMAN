# RoSeMAN documentation

**Ro**obonomics **Se**ensors **M**easure Analytics and **A**rchive **N**ode — indexer for an air-quality sensor network's data from the `datalog` and `rws` pallets of the Robonomics parachain, with a REST API on top of the collected data.

The documentation covers every project component: blockchain indexer, IPFS processing, geocoding, REST API, metrics and deployment.

## Contents

### Getting started

- **[Architecture](./architecture.md)** — project modules, run modes (full / headless / indexer), `.env` loading cascade, data flow between services.
- **[Deployment](./deployment.md)** — local launch, Docker Compose, multi-instance configuration (Polkadot + Kusama + REST API on a single DB).

### Services

- **[Indexer](./indexer.md)** — `BlockIndexerService` (catch-up + realtime + reconnect), event and extrinsic handlers, IPFS payload processing (`MeasurementProcessorService`), sensor geocoding (`GeocodingService`), data formats, MongoDB schemas, configuration (`.env`).

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
| IPFS fetch, gateway fallback               | [indexer.md → MeasurementProcessorService](./indexer.md#measurementprocessorservice) |
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
- **iconv-lite** — payload decoding for arbitrary encodings
- ESLint + Prettier
