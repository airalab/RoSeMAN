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
- `insertManyIgnoreDuplicates(docs)` — `bulkWrite` with `ordered: false`; duplicates by the unique `{sensor_id, timestamp}` are silently ignored.
- Time-range and filter queries for the V1/V2 controllers (`getMaxData`, `getSensorList`, etc.).
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
