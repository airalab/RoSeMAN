# RoSeMAN

**Ro**obonomics **Se**ensors **M**easure Analytics and **A**rchive **N**ode -- the indexer and analytics backend for [sensors.social](https://sensors.social). RoSeMAN watches the Robonomics parachain for sensor datalogs, fetches measurement data from IPFS, and serves it via REST API.

## Features

- **Robonomics blockchain indexer** (Polkadot/Kusama) — reads finalized blocks and processes `datalog.NewRecord` events and RWS extrinsics.
- **IPFS loader** — asynchronous processing of `datalog` records with CIDs: fetches JSON via a list of gateways with fallback, parses it and stores sensor measurements.
- **Reverse geocoding** — derives country/region/city from sensor coordinates.
- **REST API** — sensor data (V1/V2), story list, indexer status. See [docs/api_endpoints.md](./docs/api_endpoints.md).
- **Prometheus metrics** at `/metrics`.
- **Flexible composition** — every functional module (`API`, `INDEXER`, `MEASUREMENT`, `GEOCODING`) is toggled by environment flags, which makes it possible to run the REST API, indexer and IPFS processor as separate instances.

## Stack

- **NestJS 11** + TypeScript (ESM)
- **MongoDB** via **Mongoose**
- **@polkadot/api**
- ESLint + Prettier

A detailed description of the indexer, data formats and DB schemas is in [docs/indexer.md](./docs/indexer.md).

## Project structure

```
src/
├── api/                  REST controllers: sensor (V1/V2), story, status
├── robonomics/           chain connection, BlockIndexerService, handlers/
├── measurement/          IPFS fetcher and measurement processor
├── geocoding/            sensor reverse geocoding
├── metrics/              Prometheus metrics
├── database/
│   ├── schemas/          Mongoose schemas
│   └── repositories/     DB access (Repository pattern)
├── config/               configs (app, robonomics, ipfs, geocoding)
├── common/               constants and utilities
└── app.module.ts         dynamic module composition driven by env flags
```

## Configuration

Environment files:

- `.env` — shared settings + REST API (see [.env.example](./.env.example))
- `.env.polkadot` — Polkadot indexer (see [.env.polkadot.example](./.env.polkadot.example))
- `.env.kusama` — Kusama indexer (see [.env.kusama.example](./.env.kusama.example))

Key flags for splitting processes:

| Variable               | Purpose                                                          |
|------------------------|------------------------------------------------------------------|
| `API_ENABLED`          | REST API + Prometheus                                            |
| `INDEXER_ENABLED`      | Robonomics block scanner                                         |
| `MEASUREMENT_ENABLED`  | IPFS_PENDING polling and measurement parsing                     |
| `GEOCODING_ENABLED`    | Reverse geocoding                                                |
| `ENABLED_HANDLERS`     | Allowlist of indexer handlers (comma-separated)                  |
| `DISABLED_HANDLERS`    | Denylist of handlers (applied on top of the allowlist)           |

The full list of variables and defaults is in the `*.example` files and in [docs/indexer.md](./docs/indexer.md).

## Running

### Locally (dev)

```bash
npm install
npm run start:dev                  # API + all modules from .env
npm run start:dev:polkadot         # Polkadot indexer (.env.polkadot)
npm run start:dev:kusama           # Kusama indexer  (.env.kusama)
```

### Production

```bash
npm run build
npm run start:prod                 # API
npm run start:polkadot             # Polkadot indexer
npm run start:kusama               # Kusama indexer
```

### Docker

The [`docker-compose.yml`](./docker-compose.yml) ships MongoDB and three application instances: REST API, Polkadot indexer, Kusama indexer. Configuration is supplied to the containers via bind-mounts of the corresponding `.env` files.

```bash
cp .env.example .env
cp .env.polkadot.example .env.polkadot
cp .env.kusama.example .env.kusama
docker compose up -d
```

REST API will be available at `http://localhost:3000/api`, metrics — at `/metrics`.

## npm scripts

| Command           | Description                           |
|-------------------|---------------------------------------|
| `build`           | Build via `nest build`                |
| `start` / `start:dev` | Run (with watch in dev)           |
| `start:prod`      | Run the built `dist/main`             |
| `format`          | Prettier over `src/` and `test/`      |
| `lint`            | ESLint with autofix                   |
| `test`            | Jest (unit)                           |
| `test:e2e`        | Jest with the config from `test/`     |

## Documentation

The full documentation lives in **[docs/](./docs/README.md)**:

- [Architecture](./docs/architecture.md) — modules, run modes, data flow
- [Deployment](./docs/deployment.md) — npm/Docker, multi-instance setup
- [Indexer](./docs/indexer.md) — `BlockIndexer`, handlers, IPFS, geocoding, DB schemas, configuration
- [REST API](./docs/api.md) — HTTP layer design, validation, error handling
- [Endpoint reference](./docs/api_endpoints.md) — REST endpoint reference
- [Database](./docs/database.md) — Repository pattern, repositories overview
- [Metrics](./docs/metrics.md) — Prometheus `/metrics` endpoint
