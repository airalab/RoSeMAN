# Deployment

This document describes practical scenarios for running RoSeMAN. The architectural context (what modules and modes mean) is in [architecture.md](./architecture.md).

## Environment files

The repository root contains three `.example` files from which you should create real `.env` files:

| File                | Role                                                                              |
|---------------------|-----------------------------------------------------------------------------------|
| `.env`              | Base: MongoDB, module flags, Robonomics accounts, IPFS, Nominatim and CPS settings   |
| `.env.polkadot`     | **Polkadot** indexer: `ROBONOMICS_WS`, `ROBONOMICS_STATE_KEY=polkadot_robonomics`, `ROBONOMICS_START_BLOCK`, `API_ENABLED=false`, the desired `ENABLED_HANDLERS` set |
| `.env.kusama`       | **Kusama** indexer: same as above, but with the Kusama endpoint and start block   |

The loading cascade (`src/env-bootstrap.ts`):

1. The shared `.env` is read (the base).
2. If `DOTENV_CONFIG_PATH` is set — the specified file is read with `override: true`, overwriting any matching variables.

The full list of variables and defaults is in [indexer.md → Configuration](./indexer.md#configuration).

## Local development

```bash
npm install

# All-in-one (API + indexer + IPFS + geocoder) from .env
npm run start:dev

# Headless: Polkadot indexer only (loads .env.polkadot on top of .env)
npm run start:dev:polkadot

# Headless: Kusama indexer only
npm run start:dev:kusama
```

`start:dev*` uses `nest start --watch` — changes in `src/` restart the process. To connect to a local MongoDB, set `MONGODB_URI=mongodb://localhost:27017/roseman` in `.env` or run MongoDB in Docker (see below). CPS remains off unless `CPS_ENABLED=true`.

## Production

### Direct Node run

```bash
npm run build

npm run start:prod         # API from .env
npm run start:polkadot     # Polkadot indexer (.env.polkadot)
npm run start:kusama       # Kusama indexer  (.env.kusama)
```

`start:polkadot` and `start:kusama` propagate `DOTENV_CONFIG_PATH` via `dotenv` and start `dist/main`. See `package.json`.

### Indexes on first deploy

Automatic index creation is **disabled by default** (`autoIndex: false`), so on a fresh database apply the indexes explicitly once after deploy:

```bash
npm run sync-indexes
# per environment / database, if they differ:
DOTENV_CONFIG_PATH=.env.kusama npm run sync-indexes
```

For large collections, create indexes manually via `mongosh` instead (online build, no drops). See [database.md → Index management](./database.md#index-management).

## Docker

The repository root contains `Dockerfile` and `docker-compose.yml`.

### Image

The `Dockerfile` copies a **prebuilt `dist/`**, so the TypeScript build happens **before** the image build:

```bash
npm run build
docker build -t vol4/roseman:v0.1.0 .
```

The current image runs plain `npm ci`, so it does contain `devDependencies` and the TypeScript toolchain from the lockfile. It is reproducible, but not production-minimal; changing that would require a Dockerfile update such as a production-only dependency stage.

### Docker Compose

`docker-compose.yml` brings up four services:

| Service             | Image                  | Purpose                                                            |
|---------------------|------------------------|--------------------------------------------------------------------|
| `mongodb`           | `mongo:8`              | DB, healthcheck via `db.adminCommand('ping')`, volume `./mongodb-data` |
| `rest-api`          | `vol4/roseman:v0.1.0`  | REST API (reads `.env`)                                            |
| `indexer-polkadot`  | `vol4/roseman:v0.1.0`  | Polkadot indexer (`DOTENV_CONFIG_PATH=/app/.env.polkadot`)         |
| `indexer-kusama`    | `vol4/roseman:v0.1.0`  | Kusama indexer (`DOTENV_CONFIG_PATH=/app/.env.kusama`)             |

Configuration is supplied to the containers via **bind-mounts** of the corresponding `.env` files in read-only mode. All applications depend on `mongodb` with `condition: service_healthy`. The checked-in example files keep `CPS_ENABLED=false`, so the root Compose stack does not index CPS until its environment is explicitly changed.

```bash
cp .env.example .env
cp .env.polkadot.example .env.polkadot
cp .env.kusama.example .env.kusama

docker compose up -d
docker compose logs -f indexer-polkadot
```

After startup:
- REST API: `http://localhost:3000/api`
- Metrics: `http://localhost:3000/metrics`
- MongoDB: `localhost:27017` (`admin` / `secret` by default — change via `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD`)

## Multi-instance deployment

A typical production setup is to **split the roles across processes** so that each role can be scaled independently:

```
┌──────────────────────────┐    ┌────────────────────────────┐
│ REST API + Geocoding     │    │ Indexer Polkadot           │
│ + Measurement processor  │    │ (headless, datalog only)   │
│ API_ENABLED=true         │    │ API_ENABLED=false          │
│ MEASUREMENT_ENABLED=true │    │ INDEXER_ENABLED=true       │
│ GEOCODING_ENABLED=true   │    │ ENABLED_HANDLERS=          │
│ INDEXER_ENABLED=false    │    │   datalog-new-record       │
└────────────┬─────────────┘    └─────────────┬──────────────┘
             │                                │
             │       ┌────────────────────────┴───┐
             │       │ Indexer Kusama             │
             │       │ (headless, datalog only)   │
             │       │ API_ENABLED=false          │
             │       │ INDEXER_ENABLED=true       │
             │       │ ENABLED_HANDLERS=          │
             │       │   datalog-new-record       │
             │       └────────────┬───────────────┘
             │                    │
             ▼                    ▼
        ┌────────────────────────────────┐
        │           MongoDB              │
        │  index_state.{polkadot,kusama} │
        └────────────────────────────────┘
```

Key points:

- **Indexer state is separated by `ROBONOMICS_STATE_KEY`** in the `index_state` collection (`polkadot_robonomics`, `kusama_robonomics`, …). One MongoDB serves both indexers without conflicts.
- **`MEASUREMENT_ENABLED` only needs to be enabled on one instance** — it starts both `MeasurementProcessorService` and `CpsAnchorProcessorService`. The legacy processor polls `datalogs`; when `CPS_ENABLED=true`, the CPS processor atomically claims `cps_anchors` with a lease. Unique measurement indexes keep repeated writes idempotent, but extra processor instances are usually redundant.
- **`GEOCODING_ENABLED`** — same idea; it makes sense to keep it on a single instance because of Nominatim's rate limit.
- **The REST API can be horizontally scaled** — it is stateless and reads the DB through repositories. Behind a load balancer you can put N instances with `API_ENABLED=true` and all the other flags set to `false`.

### Dedicated CPS role

A CPS-only chain and payload worker can use:

```env
API_ENABLED=false
INDEXER_ENABLED=true
MEASUREMENT_ENABLED=true
GEOCODING_ENABLED=false
CPS_ENABLED=true
CPS_NODE_IDS=0
ENABLED_HANDLERS=cps-payload-set
```

A non-empty `CPS_NODE_IDS` drives the initial snapshot and restricts realtime events to the same allowlist. If it is empty or absent, snapshot reads no nodes while realtime accepts any numeric NodeId. `MEASUREMENT_ENABLED=true` also creates the legacy datalog processor; with `datalog-new-record` excluded it receives no new legacy records, but it can still process old pending rows already present in the shared database.

See also [architecture.md → Run modes](./architecture.md#run-modes).

## Healthcheck and shutdown

- **MongoDB:** in `docker-compose.yml` — `healthcheck: db.adminCommand('ping')`. All `roseman` services start only after `service_healthy`.
- **RoSeMAN:** `app.enableShutdownHooks()` is enabled in both modes (API/headless). On `SIGTERM`/`SIGINT` NestJS calls `OnModuleDestroy`, in particular `RobonomicsService.onModuleDestroy()`, which cleanly closes the WebSocket.
- There is currently no HTTP healthcheck endpoint (`/health`). For containerized infrastructure you can rely on `/api/status/last-block` or Prometheus metrics.

## Logging

Logs are written through `@nestjs/common` `Logger` to stdout. Levels:

- `Logger.log` — normal events (service startup, catch-up progress).
- `Logger.warn` — connection drops, IPFS gateway failures, Nominatim errors (best-effort).
- `Logger.error` — unhandled exceptions.
- `Logger.debug` — details of processing for individual events and blocks.

In `docker compose`, logs are available via `docker compose logs -f <service>`.
