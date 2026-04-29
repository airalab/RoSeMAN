# Architecture

RoSeMAN is **a NestJS application that simultaneously serves as REST API server, blockchain indexer, IPFS data processor, and geocoder**. What exactly is started up at process boot is determined by environment flags. The same artifact can be launched in different configurations and the roles can be scaled independently.

See also:
- [Deployment](./deployment.md) — practical run scenarios;
- [Indexer](./indexer.md) — internal service details;
- [REST API](./api.md) — HTTP layer design.

## Top-level modules

`AppModule` (`src/app.module.ts`) builds its imports list **dynamically** via the `buildImports()` function — modules are added based on env flags:

| Flag                   | Default | What it enables                                                           |
|------------------------|---------|---------------------------------------------------------------------------|
| `API_ENABLED`          | `true`  | `StatusModule`, `SensorModule`, `StoryModule`, `MetricsModule`, `PrometheusModule` |
| `INDEXER_ENABLED`      | `true`  | `RobonomicsModule` (BlockIndexer + 4 handlers)                            |
| `MEASUREMENT_ENABLED`  | `true`  | `MeasurementModule` (IPFS fetcher + processor)                            |
| `GEOCODING_ENABLED`    | `true`  | `GeocodingModule` (Nominatim reverse)                                     |

A flag is treated as disabled **only** when explicitly set to `'false'` — any other value (or its absence) is treated as `true`.

Always wired in:

- `ConfigModule.forRoot({ isGlobal: true, load: [...] })` — loads configs from `src/config/`.
- `MongooseModule.forRootAsync(...)` — connects to MongoDB via `MONGODB_URI`.
- `DatabaseModule` — global module with schemas and repositories (see [database.md](./database.md)).

## Run modes

Scenarios are achieved by combining flags. The application itself, in `main.ts`, only distinguishes two cases by `API_ENABLED`:

- **API mode** (`API_ENABLED !== 'false'`) — `NestFactory.create(AppModule)`, an HTTP server is started on `PORT`, with `enableCors()`, the global `/api` prefix (excluding `/metrics`), `ValidationPipe` and `AllExceptionsFilter`.
- **Headless mode** (`API_ENABLED=false`) — `NestFactory.createApplicationContext(AppModule)`. No HTTP server is started; only background services run. At startup the application logs `RoSeMAN running in headless mode (API disabled)`.

Typical configurations:

| Configuration                       | `API` | `INDEXER` | `MEASUREMENT` | `GEOCODING` | Purpose                                          |
|-------------------------------------|-------|-----------|---------------|-------------|--------------------------------------------------|
| All-in-one (dev)                    | ✅    | ✅        | ✅            | ✅          | Local development                                |
| REST API + IPFS + geocoder          | ✅    | ❌        | ✅            | ✅          | Read-side instance without chain reads           |
| Polkadot indexer                    | ❌    | ✅        | ❌            | ❌          | Headless, reads only Polkadot blocks             |
| Kusama indexer (datalog only)       | ❌    | ✅        | ❌            | ❌          | Headless, `ENABLED_HANDLERS=datalog-new-record`  |
| IPFS processor                      | ❌    | ❌        | ✅            | ❌          | Headless, dedicated process for IPFS load        |

Ready-made `.env` examples for typical roles live at the repository root: `.env.example`, `.env.polkadot.example`, `.env.kusama.example`.

## Data flow

```
Robonomics (Polkadot/Kusama) ──────▶ BlockIndexerService
                                     │
                  ┌──────────────────┼──────────────────┐
                  ▼                  ▼                  ▼
              datalogs         subscriptions          stories
                  │
                  │  status: IPFS_PENDING
                  ▼
          MeasurementProcessor ─── IpfsFetcher ─── IPFS gateways
                  │
        ┌─────────┴────────┐
        ▼                  ▼
   measurements         sensors  ──▶ GeocodingService ──▶ Nominatim
                                                          (city/state/country)

REST API (controllers) ──▶ Repositories ──▶ MongoDB (any of the collections)
```

A detailed description of each node is in [indexer.md](./indexer.md).

## `.env` cascade

The file `src/env-bootstrap.ts` is the **first side-effect import** in `main.ts`. It must run before `AppModule` is loaded, because `ConfigModule.forRoot()` reads `.env` already at module-decoration time (in ESM, side-effect imports run in topological order — leaves first).

Algorithm:

1. `dotenv.config()` — reads the base `.env` from cwd.
2. If `DOTENV_CONFIG_PATH` is set — calls `dotenv.config({ path, override: true })` again, overwriting matching variables.

This produces a two-layer configuration: a base `.env` for shared settings (e.g. `MONGODB_URI`, `PORT`) + a specialized file (`.env.polkadot`, `.env.kusama`) that defines the instance role.

Example: `DOTENV_CONFIG_PATH=.env.polkadot node dist/main` — the shared `.env` provides the MongoDB URI, while `.env.polkadot` disables the API, enables the indexer and sets `ROBONOMICS_WS`/`ROBONOMICS_STATE_KEY` for the Polkadot network.

## NestJS lifecycle

- `app.enableShutdownHooks()` is called in both modes. This is needed so that `OnModuleDestroy` fires and `RobonomicsService.disconnect()` cleanly closes the WebSocket on `SIGTERM`/`SIGINT`.
- Background services (`BlockIndexer`, `MeasurementProcessor`, `Geocoding`) are started in `OnModuleInit` as fire-and-forget — NestJS startup is not blocked.
- `ValidationPipe` is configured globally with `{ whitelist: true, transform: true }` — DTO classes from `src/api/**/dto/` automatically strip unknown fields and coerce types.

## `src/` layout

```
src/
├── app.module.ts                  dynamic buildImports() driven by env flags
├── main.ts                        bootstrap + headless detection
├── env-bootstrap.ts               cascading .env loader
│
├── api/                           REST layer (see api.md and api_endpoints.md)
│   ├── common/                    DateRangeGuard, AllExceptionsFilter
│   ├── status/                    /api/status/...
│   ├── sensor/                    /api/sensor/...  (V1) and /api/v2/sensor/...
│   └── story/                     /api/v2/story/...
│
├── robonomics/                    indexer (see indexer.md)
├── measurement/                   IPFS processor (see indexer.md)
├── geocoding/                     Nominatim reverse (see indexer.md)
├── metrics/                       Prometheus (see metrics.md)
│
├── database/                      schemas and repositories (see database.md)
├── config/                        @nestjs/config registerAs(...)
└── common/                        constants and utilities
```
