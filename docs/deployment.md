# Deployment

This document describes practical scenarios for running RoSeMAN. The architectural context (what modules and modes mean) is in [architecture.md](./architecture.md).

## Environment files

The repository root contains two `.example` files from which you should create real `.env` files:

| File            | Role                                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.env`          | Base: Docker Compose settings, MongoDB, module flags, Robonomics accounts, IPFS, Nominatim and CPS settings                                                          |
| `.env.polkadot` | **Polkadot** CPS/RWS worker: indexer connection, CPS storage/processing and the `cps-payload-set,rws-extrinsic,rws-story` handler allowlist                         |

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
```

`start:dev*` uses `nest start --watch` — changes in `src/` restart the process. To connect to a local MongoDB, set `MONGODB_URI=mongodb://localhost:27017/roseman` in `.env` or run MongoDB in Docker (see below). The base REST profile does not run background workers; `.env.polkadot` enables CPS indexing, processing and storage.

## Production

### Direct Node run

```bash
npm run build

npm run start:prod         # API from .env
npm run start:polkadot     # Polkadot indexer (.env.polkadot)
```

`start:polkadot` propagates `DOTENV_CONFIG_PATH` via `dotenv` and starts `dist/main`. See `package.json`.

### Indexes on first deploy

Automatic index creation is **disabled by default** (`autoIndex: false`), so on a fresh database apply the indexes explicitly once after deploy:

```bash
npm run sync-indexes
# for the Polkadot indexer environment, if it uses another database:
DOTENV_CONFIG_PATH=.env.polkadot npm run sync-indexes
```

For large collections, create indexes manually via `mongosh` instead (online build, no drops). See [database.md → Index management](./database.md#index-management).

## Docker

The repository root contains `Dockerfile` and `docker-compose.yml`.

### Image

The multi-stage `Dockerfile` installs the locked dependencies and builds TypeScript inside the builder stage. The runtime stage contains compiled `dist/` and production dependencies only, so no host-side build is required:

```bash
docker build -t roseman:local .
```

Compose uses the same Dockerfile and builds the image from the repository root. `ROSEMAN_IMAGE` in `.env` controls its tag.

### Docker Compose

`docker-compose.yml` brings up three services:

| Service            | Image                         | Purpose                                                          |
| ------------------ | ----------------------------- | ---------------------------------------------------------------- |
| `mongodb`          | `mongo:8`                     | DB with authenticated healthcheck and named volume               |
| `rest-api`         | `${ROSEMAN_IMAGE}` / built    | REST API; reads `.env`                                           |
| `indexer-polkadot` | `${ROSEMAN_IMAGE}` / built    | Polkadot CPS/RWS worker; reads `.env`, then `.env.polkadot`       |

Configuration is supplied through Compose `env_file`; environment files are not copied into the image or mounted into containers. Compose overrides `MONGODB_URI` with the internal `mongodb` hostname and the credentials from `.env`. All applications depend on the authenticated MongoDB healthcheck. The Polkadot example enables CPS with canonical and raw storage. Its explicit handler allowlist enables `cps-payload-set`, `rws-extrinsic` and `rws-story`, so legacy `datalog-new-record` remains disabled.

```bash
cp .env.example .env
cp .env.polkadot.example .env.polkadot

docker compose up -d --build
docker compose logs -f indexer-polkadot
```

After startup:

- REST API: `http://localhost:${REST_PORT:-3000}/api`
- Metrics: `http://localhost:${REST_PORT:-3000}/metrics`
- MongoDB: `localhost:${MONGO_PORT:-27017}` (`admin` / `secret` in the local example; change `MONGO_ROOT_USER` / `MONGO_ROOT_PASSWORD` outside local development)

The database uses the Compose-managed `mongodb-data` volume. Stop containers without deleting data with `docker compose down`; use `docker compose down -v` only when the local database should be recreated.

## Multi-instance deployment

A typical production setup is to **split the roles across processes** so that each role can be scaled independently:

```
┌──────────────────────────┐    ┌────────────────────────────┐
│ REST API                 │    │ Polkadot CPS/RWS worker    │
│ API_ENABLED=true         │    │ API_ENABLED=false          │
│ MEASUREMENT_ENABLED=false│    │ INDEXER_ENABLED=true       │
│ GEOCODING_ENABLED=false  │    │ MEASUREMENT_ENABLED=true   │
│ INDEXER_ENABLED=false    │    │ ENABLED_HANDLERS=          │
│                          │    │   cps-payload-set,          │
│                          │    │   rws-extrinsic,rws-story   │
└────────────┬─────────────┘    └─────────────┬──────────────┘
             │                                │
             ▼                                ▼
        ┌────────────────────────────────┐
        │           MongoDB              │
        │ index_state.polkadot_robonomics │
        └────────────────────────────────┘
```

Key points:

- **Indexer state uses `ROBONOMICS_STATE_KEY=polkadot_robonomics`** in the `index_state` collection, so the Polkadot checkpoint is stable across process restarts.
- **`MEASUREMENT_ENABLED` is enabled on the Polkadot worker only** — it starts both `MeasurementProcessorService` and `CpsAnchorProcessorService`. The CPS processor atomically claims `cps_anchors` with a lease. The legacy processor may drain old pending rows, but no new datalog rows are created because `datalog-new-record` is absent from `ENABLED_HANDLERS`.
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
CPS_CANONICAL_STORAGE_ENABLED=true
CPS_RAW_PAYLOAD_STORAGE_ENABLED=true
CPS_NODE_IDS=0
ENABLED_HANDLERS=cps-payload-set
```

A non-empty `CPS_NODE_IDS` drives the initial snapshot and restricts realtime events to the same allowlist. If it is empty or absent, snapshot reads no nodes while realtime accepts any numeric NodeId. The two storage flags enable the lossless/canonical dual write; both default to `false` for a controlled rollout. `MEASUREMENT_ENABLED=true` also creates the legacy datalog processor; with `datalog-new-record` excluded it receives no new legacy records, but it can still process old pending rows already present in the shared database.

See also [architecture.md → Run modes](./architecture.md#run-modes).

### Canonical CPS backfill

Preview one bounded batch without downloading or writing payloads:

```bash
npm run backfill-connectivity -- --dry-run --start-block 1000000 --end-block 1100000 --limit 100
```

Run the same range, optionally narrowed to one CID:

```bash
npm run backfill-connectivity -- --start-block 1000000 --end-block 1100000 --limit 100
npm run backfill-connectivity -- --cid <CID> --limit 1
```

The command uses the configured `MONGODB_URI`, IPFS gateways, CPS wire format and decoder limits. It never rewrites `measurements` and does not modify the main anchor queue status. Successful entries are skipped on subsequent runs unless `--force` is passed; failed entries remain eligible for retry. A non-zero failed count sets the process exit code to `1`.

## Healthcheck and shutdown

- **MongoDB:** in `docker-compose.yml` — authenticated `healthcheck: db.adminCommand('ping')`. All `roseman` services start only after `service_healthy`.
- **RoSeMAN:** `app.enableShutdownHooks()` is enabled in both modes (API/headless). On `SIGTERM`/`SIGINT` NestJS calls `OnModuleDestroy`, in particular `RobonomicsService.onModuleDestroy()`, which cleanly closes the WebSocket.
- There is currently no HTTP healthcheck endpoint (`/health`). For containerized infrastructure you can rely on `/api/status/last-block` or Prometheus metrics.

## Logging

Logs are written through `@nestjs/common` `Logger` to stdout. Levels:

- `Logger.log` — normal events (service startup, catch-up progress).
- `Logger.warn` — connection drops, IPFS gateway failures, Nominatim errors (best-effort).
- `Logger.error` — unhandled exceptions.
- `Logger.debug` — details of processing for individual events and blocks.

In `docker compose`, logs are available via `docker compose logs -f <service>`.
