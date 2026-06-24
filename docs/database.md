# Database

The storage is **MongoDB** (Mongoose 7). Data access is organized using the **Repository pattern**: all reads and writes go through classes from `src/database/repositories/`. Services, handlers and controllers do not use `@InjectModel` directly — they only inject the corresponding repository.

See also:
- [indexer.md → MongoDB schemas](./indexer.md#mongodb-schemas) — fields, indexes and unique constraints of every collection.
- [architecture.md](./architecture.md) — how `DatabaseModule` is wired into `AppModule`.

## DatabaseModule

`src/database/database.module.ts` — a global (`@Global()`) module:

- registers all Mongoose schemas via `MongooseModule.forFeature([...])`;
- registers all repositories as providers and exports them;
- thanks to `@Global()`, the repositories can be injected from any module of the application without an explicit `imports: [DatabaseModule]`.

The MongoDB connection is configured at the `AppModule` level:

```ts
MongooseModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (cfg) => ({ uri: cfg.get<string>('app.mongodbUri') }),
})
```

The URI comes from `MONGODB_URI` (default `mongodb://localhost:27017/roseman`).

## Index management

Indexes are declared in the schemas (`@Prop({ index: true })` and `Schema.index(...)`), but **automatic creation on startup is disabled by default**: the connection is opened with `autoIndex: false` (see `app.module.ts`, driven by the `app.autoIndex` config). This avoids spontaneous, foreground index builds on large hot collections every time a process boots.

`autoIndex` is controlled by `MONGODB_AUTO_INDEX` (default `false`). For local development you may set `MONGODB_AUTO_INDEX=true` so Mongoose creates missing indexes on startup.

In production, apply indexes explicitly as a deploy step. Two options:

### 1. `npm run sync-indexes`

Runs `src/scripts/sync-indexes.ts`: boots a minimal context (DB connection + all schemas, **no** HTTP server / indexer / pollers) and calls `Model.syncIndexes()` for every model.

```bash
npm run sync-indexes
# for another environment / database:
DOTENV_CONFIG_PATH=.env.kusama npm run sync-indexes
```

⚠️ `syncIndexes()` makes the collection match the schema exactly — it creates missing indexes **and drops indexes that are no longer declared**. Review the schemas before running it in production.

### 2. Manually via `mongosh` (recommended for large collections)

Gives full control and avoids dropping anything. Since MongoDB 4.2 index builds are effectively online (the legacy `{ background: true }` option is accepted but a no-op):

```js
// create the new owner lookup index without blocking writes
db.measurements.createIndex({ owner: 1, sensor_id: 1 }, { background: true })

// verify
db.measurements.getIndexes()
```

> Tip: a `unique` index (e.g. `{ sensor_id: 1, timestamp: 1 }`) will fail to build if the collection already contains duplicates (`E11000`). Resolve duplicates first, then create the index.

## Collections and repositories

| Mongoose class    | Collection       | Repository               | Where it is used                                  |
|-------------------|------------------|--------------------------|---------------------------------------------------|
| `Datalog`         | `datalogs`       | `DatalogRepository`      | `DatalogNewRecordHandler`, `MeasurementProcessor`, `MetricsService` |
| `Measurement`     | `measurements`   | `MeasurementRepository`  | `MeasurementProcessor`, `SensorService`           |
| `Sensor`          | `cities`         | `SensorRepository`       | `MeasurementProcessor`, `GeocodingService`, `SensorService` |
| `Story`           | `stories`        | `StoryRepository`        | `RwsStoryHandler`, `StoryService`                 |
| `Subscription`    | `subscriptions`  | `SubscriptionRepository` | `RwsExtrinsicHandler`, `RwsNewDevicesHandler`, `RwsStoryHandler` |
| `IndexState`      | `index_state`    | `IndexStateRepository`   | `BlockIndexerService`, `StatusController`, `MetricsService` |

A detailed description of each schema (fields, types, indexes) is in [indexer.md → MongoDB schemas](./indexer.md#mongodb-schemas).

## Why the Repository pattern

1. **Isolating Mongoose from business logic.** Services operate in domain terms like `findPending(20)` or `upsertBlock(account, owner, block)`, not raw `Model.find({...})`. This simplifies tests (repositories can be mocked) and makes it possible to swap the ORM or storage without rewriting all services.
2. **A single place for indexes and optimizations.** All `lean()`, `bulkWrite`, `insertManyIgnoreDuplicates` and `$setOnInsert` live in one layer — easier to audit performance and change indexing strategies.
3. **Protection against accidentally duplicated SQL/Mongo logic.** For example, `MeasurementRepository.insertManyIgnoreDuplicates(...)` is the only writer into `measurements` — no random `model.insertMany()` will sneak past the unique index.
4. **Consistency with the project style.** This is a hard project rule (CLAUDE.md): any new code that touches the DB must go through a repository.

## Typical repository operations

Without claiming a complete list (each file is worth reading in full), here are characteristic methods — to give a sense of each repository's responsibility.

### DatalogRepository
- `upsertRecord({ block, sender, resultHash, status, timechain })` — idempotent insert via `$setOnInsert` keyed on the unique `{block, sender, resultHash}` index.
- `findPending(limit)` — selects `status === IPFS_PENDING` with a limit for batch processing.
- `updateStatus(id, status, errorMessage?)` — finalization of a record by `MeasurementProcessor`.
- `getCountIpfsPending()` — for the `roseman_ipfs_queue` metric (see [metrics.md](./metrics.md)).

### MeasurementRepository
- `upsertMany(docs)` — uses `bulkWrite` with `upsert` to prevent duplicates; if a record with the same `sensor_id` and `timestamp` exists, it is updated.
- `insertManyIgnoreDuplicates(docs)` — `bulkWrite` with `ordered: false`; duplicates by the unique `{sensor_id, timestamp}` are silently ignored.
- Time-range and filter queries for the V1/V2 controllers (`getMaxData`, `getSensorList`, etc.).
- `findCurrentSensorIdsByOwner(owner)` — sensor IDs whose current owner is the given one (powers `GET /api/v2/sensor/owner/:owner`). Two-stage to avoid a full collection scan: a covered `distinct` over the `{owner, sensor_id}` index narrows the candidates, then a per-candidate `findOne` (sorted by `timestamp` desc, served by the `{sensor_id, timestamp}` index) reads only the latest measurement of each and keeps those whose owner still matches, and it does **not** aggregate the candidates' full history.
- Filtering by `model` via the `SENSOR_DATA_MODELS` constant from `src/common/constants/sensor-model.enum.ts`.

### SensorRepository
- `bulkUpsert([{ sensor_id, geo }])` — updates `geo` for known sensors + inserts new ones with `city/state/country: null` (the "needs geocoding" marker).
- `findWithoutCity(limit)` — used by `GeocodingService`.
- `updateLocation(_id, { city, state, country })` — writes the Nominatim result.

### StoryRepository
- `upsert({ ... })` — idempotent story insert keyed on the unique `{sensor_id, timestamp}`.
- Reads for `StoryController`: pagination, range filtering, last story per sensor.

### SubscriptionRepository
- `upsertBlock(account, owner, block)` — updates the `block` of an existing subscription or creates a new one.
- `bulkUpsert([{ account, owner }])` — bulk upsert (for `rws.NewDevices`).
- `deleteByOwnerExcept(owner, accounts)` — removes accounts that are no longer in the current device list of the subscription.
- `findAccountsByOwner(owner)` — list of subscription devices (used by `RwsStoryHandler` to verify the right to publish a story).

### IndexStateRepository
- `getValue(key)` / `upsertValue(key, value)` — reads/writes the indexer's progress (`last_indexed_block` under keys `polkadot_robonomics`, `kusama_robonomics`, etc.).
- `getAllIndex()` — for the `roseman_block_read{chain=...}` metric (see [metrics.md](./metrics.md)).

## Where to look in the code

Repository files:

```
src/database/repositories/
├── datalog.repository.ts
├── measurement.repository.ts
├── sensor.repository.ts
├── story.repository.ts
├── subscription.repository.ts
└── index-state.repository.ts
```

Mongoose schemas:

```
src/database/schemas/
├── datalog.schema.ts
├── measurement.schema.ts
├── sensor.schema.ts
├── story.schema.ts
├── subscription.schema.ts
└── index-state.schema.ts
```
