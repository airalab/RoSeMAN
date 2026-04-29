# RoSeMAN Indexer

Indexer for an air-quality sensor network's data from the `datalog` and `rws` pallets of the Robonomics parachain + IPFS payload processor + sensor geocoder.

## Architecture

```
                               ┌───────────────────────────────────────┐
                               │  RobonomicsService  (@polkadot/api)   │
                               │  WsProvider + ApiPromise              │
                               └─────────────────┬─────────────────────┘
                                                 │ getApi()
                              ┌──────────────────▼──────────────────┐
                              │       BlockIndexerService           │
Robonomics Chain ───events────▶  catch-up + realtime                │
                  extrinsics  │  events / extrinsics → handlers     │
                              └──┬──────────────────────────────────┘
                                 │
       ┌─────────────────────────┼──────────────────────────┐
       │                         │                          │
   datalog.NewRecord       rws.NewDevices             rws.call (extrinsic)
   ───────┬────────────    ──────┬──────────          ───────┬──────────────
          ▼                      ▼                           ▼
 ┌────────────────────┐ ┌──────────────────────┐ ┌────────────────────────┐
 │ DatalogNewRecord   │ │ RwsNewDevicesHandler │ │ RwsExtrinsicHandler    │
 │  Handler           │ │  → subscriptions     │ │  → subscriptions       │
 │  → datalogs        │ │     (sync owner)     │ │     (account+owner)    │
 └────────────────────┘ └──────────────────────┘ ├────────────────────────┤
                                                 │ RwsStoryHandler        │
                                                 │  parses inline JSON    │
                                                 │  → stories             │
                                                 └────────────────────────┘

      datalogs (status: IPFS_PENDING)
            │
            ▼
 ┌──────────────────────────────────┐    ┌──────────────────────┐
 │  MeasurementProcessorService     │ ◀──│  IpfsFetcherService  │
 │  poll(20) → fetch → parse        │    │  fallback over       │
 │  → measurements + sensors        │    │  IPFS_GATEWAYS       │
 │  → datalog.status PROCESSED/ERR  │    └──────────────────────┘
 └──────────────────────────────────┘
                │
                ▼
       sensors (city === null)
                │
                ▼
 ┌──────────────────────────────────┐
 │  GeocodingService                │ → Nominatim (reverse)
 │  poll → city/state/country       │
 └──────────────────────────────────┘
```

Each of the four background services (`BlockIndexer`, `MeasurementProcessor`, `Geocoding`, `RobonomicsService`) is started by its own NestJS module and is independently turned on/off by environment flags. This makes it possible to spread roles horizontally: one process is a Polkadot indexer, another is a Kusama indexer, a third is the IPFS processor, a fourth is the geocoder, a fifth is the REST API.

## BlockIndexerService

A generic block scanner (`src/robonomics/block-indexer.service.ts`). It is not tied to any specific pallet: it can match **both events and extrinsics**. The processing rules themselves are extracted into an array of **handlers**, injected via the DI tokens `EVENT_HANDLERS` and `EXTRINSIC_HANDLERS`.

### Lifecycle

1. `onModuleInit` — fire-and-forget `run()`.
2. `run()` wraps `start()` and on any exception waits `RECONNECT_DELAY = 15s`, calls `RobonomicsService.reconnect()` and restarts the indexer.
3. `start()`:
   - reads `last_indexed_block` from the `index_state` collection by the `ROBONOMICS_STATE_KEY` key (e.g. `polkadot_robonomics`, `kusama_robonomics`);
   - **catch-up** — while `from <= finalized`, processes blocks in `BATCH_SIZE = 10` batches, updating `index_state` after each block;
   - **realtime** — subscribes to `subscribeFinalizedHeads`; on every new header it calls `processBlock(blockNum)`;
   - hooks `api.on('error')` and `api.on('disconnected')` to `scheduleReconnect()` with double-fire protection (the `reconnecting` flag).

### Processing a block

`processBlock(blockNum)`:

1. If `0` event-handlers and `0` extrinsic-handlers are registered — exits immediately (no RPC).
2. Loads block events: `api.query.system.events.at(blockHash)`.
3. Builds two maps from the events:
   - `extrinsicSuccess: Map<idx, boolean>` from `system.ExtrinsicSuccess` / `system.ExtrinsicFailed`;
   - `eventsByExtrinsic: Map<idx, Event[]>` — all events of an extrinsic indexed by `phase.asApplyExtrinsic`.
4. **Events:** for every event it checks the `(section, method)` match of every `ChainEventHandler` and calls `handler.handle(event, blockNum, isSuccess)`. For events in the Initialization/Finalization phases, `isSuccess === true`.
5. **Extrinsics:** only if there are extrinsic-handlers, it makes an additional `api.rpc.chain.getBlock(blockHash)` RPC call, and for each extrinsic calls `handler.handle(extrinsic, eventsByExtrinsic.get(i) ?? [], blockNum, isSuccess)`. `ChainExtrinsicHandler.method` is `string | undefined` — if not set, it matches any method in the section.

### Handler filtering

`filterHandlers()` (`src/robonomics/handler-filter.ts`) — a single point of filtering for event- and extrinsic-handlers via env:

- `ENABLED_HANDLERS=name1,name2` — allowlist by `handler.name`.
- `DISABLED_HANDLERS=nameX` — denylist, applied on top of the allowlist.
- If both variables are empty — the filter is inactive.

Current names:

| Handler name         | Type       | Section / Method                                         |
|----------------------|------------|----------------------------------------------------------|
| `datalog-new-record` | event      | `datalog.NewRecord`                                      |
| `rws-new-devices`    | event      | `rws.NewDevices`                                         |
| `rws-extrinsic`      | extrinsic  | `rws.call`                                               |
| `rws-story`          | extrinsic  | `rws.call` (reads `datalog.NewRecord` events of the extrinsic) |

## Handlers

### DatalogNewRecordHandler

File: `src/robonomics/handlers/datalog-new-record.handler.ts`. Reacts to `datalog.NewRecord`.

- Ignores events from failed extrinsics (`isSuccess === false`).
- Extracts `sender = data[0]`, `timechain = data[1]`, `resultHash = data[2]`.
- If `ROBONOMICS_ACCOUNTS` is set — filters by whitelist.
- `resultHash` is checked by `isIpfsCid()`:
  - **CID** (CIDv0/CIDv1) → status `IPFS_PENDING`;
  - otherwise (e.g. inline JSON or an arbitrary string) → status `NEW`.
- Performs an upsert via `DatalogRepository.upsertRecord({ block, sender, resultHash, status, timechain })` with `$setOnInsert` keyed on the compound unique index `{block, sender, resultHash}` — duplicates are not created.

### RwsNewDevicesHandler

File: `src/robonomics/handlers/rws-new-devices.handler.ts`. Reacts to `rws.NewDevices`.

- `owner = event.data[0]`, `accounts = event.data[1]` — the current device list of the subscription.
- Synchronizes the `subscriptions` collection for this owner:
  - `SubscriptionRepository.deleteByOwnerExcept(owner, accounts)` — removes accounts that are no longer in the list;
  - `SubscriptionRepository.bulkUpsert(...)` — adds/updates the current ones.

### RwsExtrinsicHandler

File: `src/robonomics/handlers/rws-extrinsic.handler.ts`. Reacts to any successful extrinsic in the `rws` section (method `call`).

- `account = extrinsic.signer`, `owner = extrinsic.args[0]`.
- `SubscriptionRepository.upsertBlock(account, owner, blockNum)` — updates `block` of an existing subscription or creates a new one.

### RwsStoryHandler

File: `src/robonomics/handlers/rws-story.handler.ts`. Reacts to `rws.call`, but looks at the events that the extrinsic emitted.

- For the signer it looks up owned accounts: `SubscriptionRepository.findAccountsByOwner(signer)`. If there are none — exits.
- For every `datalog.NewRecord` among the extrinsic's events:
  - **inline JSON only** (if `isIpfsCid(resultHash)` — skipped, that's the job of `DatalogNewRecordHandler` + `MeasurementProcessor`);
  - parses the JSON, validates `model === SensorModel.STORY (5)` plus the `sensor`, `message`, `timestamp` fields;
  - checks that `payload.sensor` is in the list of owned accounts;
  - saves the story via `StoryRepository.upsert({...})` with the unique `{sensor_id, timestamp}`.

## MeasurementProcessorService

File: `src/measurement/measurement-processor.service.ts`. Polls `datalogs` with status `IPFS_PENDING`, parses the payload and saves measurements + sensors.

### Lifecycle

1. `onModuleInit` starts a `setInterval` at `IPFS_POLL_INTERVAL` (default `10_000` ms).
2. Each tick: `DatalogRepository.findPending(20)` — a batch of 20 records.
3. For each record — `processOne(doc)`.

### processOne

```
resolve payload
├── doc.resultHash starts with '{'   → JSON.parse(doc.resultHash)        (inline JSON)
└── otherwise → IpfsFetcherService.fetch(resolveIpfsPath(sender, cid))
    └── if sender === IPFS_DIR_SENDER → fetches ${cid}/data.json
        otherwise → ${cid}

parse payload
├── data.message present → parseMessageData()        (message format)
└── otherwise → parseSensorData()                     (sensor dictionary)

write
├── MeasurementRepository.insertManyIgnoreDuplicates(measurements)
├── SensorRepository.bulkUpsert(unique_sensors_geo)
└── DatalogRepository.updateStatus(_id, PROCESSED)         or ERROR + errorMessage
```

### parseSensorData

Expects a dictionary `{ [sensor_id]: { model, geo?, donated_by?, measurements: [...] } }`.

- `model` and `measurements: []` are required. Otherwise the sensor is skipped.
- `geo` is required. It can be at the sensor level (stationary, `model !== MOVE`) or in each reading (mobile, `model === MOVE = 3`). The string `"lat,lng"` is parsed into `{ lat, lng }`.
- In the `measurement` object, `timestamp` and `geo` are excluded. Remaining keys are lower-cased, values are coerced via `Number(...)`.
- Deduplication within a single payload is done by `sensor_id:timestamp` (Set). At the DB level, the unique compound `{sensor_id, timestamp}` provides an additional layer.

### parseMessageData

Expects an object with a `message` field at the top level (a single measurement record, not a dictionary).

- Required: `model`, `geo`, `timestamp`. Otherwise the record is skipped.
- `sensor_id` — from the payload, or fallback `DEFAULT_MESSAGE_SENSOR_ID = 'd32ac7f...'` (hard-coded in the service).
- `message` is decoded via `iconv.decode(Buffer.from(data.message), 'utf8')` — the payload may contain raw bytes in a non-UTF-8 encoding.
- Saved as a single measurement with the fields: `username`, `message`, `timestamp`, `ipfs` (the original `resultHash`), `images`, `type`.

### upsertSensors

After successful parsing of measurements, unique sensors by `sensor_id` are written into the `cities` collection (Sensor): `geo` is updated on every upsert, and the `city/state/country` fields are set to `null` **only on insert** — that's the "needs geocoding" marker.

### IpfsFetcherService

`src/measurement/ipfs-fetcher.service.ts`. Iterates through gateways from `IPFS_GATEWAYS` in order. Each request is `fetch` with an `AbortController` and an `IPFS_FETCH_TIMEOUT` timeout. If all gateways fail, it throws `Error('All IPFS gateways failed for CID ...')`, and `processOne()` marks the datalog as `ERROR` with an `errorMessage`.

## GeocodingService

File: `src/geocoding/geocoding.service.ts`. Enriches records of the `cities` collection (Sensor) with location data via **Nominatim reverse geocoding**.

### Lifecycle

1. `onModuleInit` starts a `setInterval` at `GEOCODING_POLL_INTERVAL` (default `30_000` ms).
2. Each tick: `SensorRepository.findWithoutCity(GEOCODING_BATCH_SIZE)` — picks up records with `city === null`.
3. For each one it issues a request to `NOMINATIM_BASE_URL?lat=&lon=&format=json&zoom=10&accept-language=en` with the header `User-Agent: NOMINATIM_USER_AGENT` and an `NOMINATIM_FETCH_TIMEOUT` timeout.
4. Between requests there is a pause of `NOMINATIM_REQUEST_INTERVAL` (default `1100` ms — to honor the Nominatim 1 req/s rate limit).
5. From the response it picks:
   - `city || town || village || hamlet` → `city`;
   - `state || county || state_district || region` → `state`;
   - `country` → `country`.
6. On error / invalid response it writes empty strings `''` (not `null`), so the record is not picked up by polling again.

## RobonomicsService

`src/robonomics/robonomics.service.ts`. Connection manager for the parachain.

- On `onModuleInit` it creates `WsProvider(ROBONOMICS_WS) + ApiPromise.create()`. `getApi()` returns `Promise<ApiPromise>` — calling services wait for readiness.
- `WsProvider` has built-in auto-reconnect, so short blips are handled at the provider level. A full `disconnect → connect` cycle is performed by `reconnect()`, which is invoked from `BlockIndexerService` on errors or explicit `disconnected` events.
- `onModuleDestroy` tears the connection down.

---

## Data formats

### `datalog.NewRecord` event

```
event.section: "datalog"
event.method:  "NewRecord"
event.data[0]: "4HMPh33CSbyt5fjDQeaHv4V7TRUKycKx4Q8vBGAekq49rm14"  // sender
event.data[1]: 1771591679000                                       // timechain (ms)
event.data[2]: "QmXYZ..." | "{...inline JSON...}" | "string"       // resultHash
```

### IPFS payload — "sensor dictionary" format (`parseSensorData`)

```json
{
  "airalab_sensor_001": {
    "model": 2,
    "geo": "34.687200,33.047800",
    "donated_by": "some_donor",
    "measurements": [
      { "temperature": 21.66, "pm10": 1.1, "timestamp": 1771591679 }
    ]
  },
  "mobile_sensor_042": {
    "model": 3,
    "measurements": [
      { "temperature": 18.57, "geo": "47.25,-1.44", "timestamp": 1771591977 },
      { "temperature": 19.57, "geo": "47.26,-1.45", "timestamp": 1771592977 }
    ]
  }
}
```

### IPFS payload — "message" format (`parseMessageData`)

```json
{
  "message": "<bytes>",
  "model": 4,
  "geo": "47.25,-1.44",
  "timestamp": 1771591977,
  "sensor_id": "optional",
  "username": "alice",
  "donated_by": "",
  "images": ["bafy..."],
  "type": 0
}
```

`message` may contain non-UTF-8 bytes — decoded via `iconv-lite`.

### Inline JSON — "story" format (`RwsStoryHandler`)

Not a CID — `resultHash` is parsed directly as JSON:

```json
{
  "model": 5,
  "sensor": "airalab_sensor_001",
  "message": "Hello, world!",
  "timestamp": 1771591977,
  "i": "icon-name",
  "date": "2026-04-29"
}
```

### SensorModel enum

`src/common/constants/sensor-model.enum.ts`:

```
STATIC  = 2   // stationary sensor, geo at the sensor level
MOVE    = 3   // mobile sensor, geo in each reading
MESSAGE = 4   // message (format with a message field)
STORY   = 5   // story (inline JSON, RwsStoryHandler)
```

`SENSOR_DATA_MODELS = [STATIC, MOVE]` — models that carry measurements (used in `MeasurementRepository` for filtering).

---

## MongoDB schemas

### Collection `datalogs` (Datalog)

| Field          | Type     | Description                                           |
|----------------|----------|-------------------------------------------------------|
| `block`        | Number   | Block number in the chain *(indexed)*                 |
| `sender`       | String   | Account address *(indexed)*                           |
| `resultHash`   | String   | IPFS CID or arbitrary string                          |
| `status`       | Number   | `0` NEW, `1` IPFS_PENDING, `2` PROCESSED, `3` ERROR *(indexed)* |
| `timechain`    | Number   | Timestamp from the NewRecord event                    |
| `errorMessage` | String   | Error text (when `status: ERROR`)                     |
| `createdAt` / `updatedAt` | Date | timestamps                                       |

Indexes: unique `{block, sender, resultHash}`, plus single-field indexes on `block`, `sender`, `status`.

### Collection `measurements` (Measurement)

| Field         | Type     | Description                                    |
|---------------|----------|------------------------------------------------|
| `datalog_id`  | ObjectId | Reference to `datalogs._id` *(indexed)*        |
| `sensor_id`   | String   | Sensor ID *(indexed)*                          |
| `model`       | Number   | Sensor model (`SensorModel`)                   |
| `measurement` | Object   | Reading data (arbitrary JSON)                  |
| `geo`         | Object   | `{ lat: Number, lng: Number }`                 |
| `donated_by`  | String   | Donor (optional)                               |
| `timestamp`   | Number   | Unix timestamp of the reading, seconds *(indexed)* |

Indexes: unique compound `{sensor_id, timestamp}` (deduplication).

### Collection `cities` (Sensor)

| Field       | Type   | Description                                              |
|-------------|--------|----------------------------------------------------------|
| `sensor_id` | String | Sensor ID *(unique)*                                     |
| `geo`       | Object | `{ lat, lng }` — last known position                     |
| `city`      | String \| null | `null` — needs geocoding; `''` — Nominatim returned no result; otherwise the city |
| `state`     | String \| null | region/state                                     |
| `country`   | String \| null | country                                          |

### Collection `stories` (Story)

| Field       | Type   | Description                                              |
|-------------|--------|----------------------------------------------------------|
| `block`     | Number | Block number (optional)                                  |
| `author`    | String | Datalog sender address *(indexed)*                       |
| `sensor_id` | String | ID of the sensor the story relates to *(indexed)*        |
| `message`   | String | Story text                                               |
| `icon`      | String | Icon name (the `i` field from the payload)               |
| `timestamp` | Number | Unix timestamp *(indexed)*                               |
| `timechain` | Number | Event timestamp from the chain                           |
| `date`      | String \| null | Free-form date string from the payload           |

Indexes: unique compound `{sensor_id, timestamp}`.

### Collection `subscriptions` (Subscription)

| Field     | Type   | Description                                       |
|-----------|--------|---------------------------------------------------|
| `account` | String | Subscription's device account *(indexed)*         |
| `owner`   | String | Subscription owner *(indexed)*                    |
| `block`   | Number | Block number of the last update (optional)        |

Indexes: unique compound `{account, owner}`.

### Collection `index_state` (IndexState)

| Field   | Type   | Description                                         |
|---------|--------|-----------------------------------------------------|
| `key`   | String | `polkadot_robonomics`, `kusama_robonomics`, … *(unique)* |
| `value` | Number | Number of the last processed block                  |

The key is set by `ROBONOMICS_STATE_KEY` — this allows a single MongoDB instance to serve indexers of different networks at the same time.

---

## Configuration

All variables are read via `@nestjs/config` and grouped in `src/config/{app,robonomics,ipfs,geocoding}.config.ts`.

### Module flags (instance role selector)

| Variable               | Default | Purpose                                        |
|------------------------|---------|------------------------------------------------|
| `API_ENABLED`          | `true`  | StatusModule, SensorModule, StoryModule, MetricsModule |
| `INDEXER_ENABLED`      | `true`  | RobonomicsModule (BlockIndexer + handlers)     |
| `MEASUREMENT_ENABLED`  | `true`  | MeasurementProcessor + IpfsFetcher             |
| `GEOCODING_ENABLED`    | `true`  | GeocodingService                               |
| `ENABLED_HANDLERS`     | *(empty)* | Comma-separated handler allowlist            |
| `DISABLED_HANDLERS`    | *(empty)* | Handler denylist (on top of the allowlist)   |

A flag is treated as `false` only when explicitly set to `'false'` (see `app.module.ts`).

### App / MongoDB

| Variable          | Default                                   | Description                              |
|-------------------|-------------------------------------------|------------------------------------------|
| `NODE_ENV`        | `development`                             |                                          |
| `PORT`            | `3000`                                    | HTTP port for REST API                   |
| `MONGODB_URI`     | `mongodb://localhost:27017/roseman`       | MongoDB connection string                |
| `MAX_PERIOD_DAYS` | `31`                                      | API period limit (DateRangeGuard)        |

### Robonomics

| Variable                  | Default                                  | Description                                  |
|---------------------------|------------------------------------------|----------------------------------------------|
| `ROBONOMICS_WS`           | `wss://polkadot.rpc.robonomics.network`  | WebSocket endpoint of the parachain          |
| `ROBONOMICS_START_BLOCK`  | `0`                                      | Starting block (only on first launch)        |
| `ROBONOMICS_STATE_KEY`    | `polkadot_robonomics`                    | Key in the `index_state` collection          |
| `ROBONOMICS_ACCOUNTS`     | *(empty — all)*                          | Comma-separated whitelist of datalog senders |

### IPFS

| Variable             | Default                                                       | Description                          |
|----------------------|---------------------------------------------------------------|--------------------------------------|
| `IPFS_GATEWAYS`      | `https://ipfs.io/ipfs/, https://gateway.pinata.cloud/ipfs/, https://cloudflare-ipfs.com/ipfs/` | Comma-separated gateway list |
| `IPFS_FETCH_TIMEOUT` | `30000`                                                       | HTTP request timeout (ms)            |
| `IPFS_POLL_INTERVAL` | `10000`                                                       | IPFS_PENDING polling interval (ms)   |
| `IPFS_DIR_SENDER`    | *(empty)*                                                     | Sender whose CIDs are directories; data is fetched as `${cid}/data.json` |

### Geocoding (Nominatim)

| Variable                      | Default                                          | Description                                   |
|-------------------------------|--------------------------------------------------|-----------------------------------------------|
| `NOMINATIM_BASE_URL`          | `https://nominatim.openstreetmap.org/reverse`    | Reverse geocoding endpoint                    |
| `NOMINATIM_USER_AGENT`        | `RoSeMAN/1.0`                                    | User-Agent (Nominatim ToS requirement)        |
| `NOMINATIM_REQUEST_INTERVAL`  | `1100`                                           | Pause between requests (ms), rate-limit 1/s   |
| `NOMINATIM_FETCH_TIMEOUT`     | `10000`                                          | HTTP request timeout (ms)                     |
| `GEOCODING_POLL_INTERVAL`     | `30000`                                          | Polling interval for sensors with `city === null` |
| `GEOCODING_BATCH_SIZE`        | `10`                                             | Sensor batch size per polling tick            |

---

## File layout

```
src/
├── config/
│   ├── app.config.ts              — port, MongoDB URI, module flags, MAX_PERIOD_DAYS
│   ├── robonomics.config.ts       — WS endpoint, startBlock, stateKey, accounts
│   ├── ipfs.config.ts             — gateways, timeout, pollInterval, dirSender
│   ├── geocoding.config.ts        — Nominatim endpoint, rate-limit, batch
│   └── index.ts                   — config re-exports
│
├── common/
│   ├── constants/
│   │   ├── datalog-status.enum.ts — NEW=0, IPFS_PENDING=1, PROCESSED=2, ERROR=3
│   │   └── sensor-model.enum.ts   — STATIC=2, MOVE=3, MESSAGE=4, STORY=5
│   └── utils/
│       └── ipfs.util.ts           — isIpfsCid() (CIDv0/CIDv1 detect)
│
├── database/
│   ├── database.module.ts         — global module (schemas + repositories)
│   ├── schemas/
│   │   ├── datalog.schema.ts      — datalogs, unique {block, sender, resultHash}
│   │   ├── measurement.schema.ts  — measurements, unique {sensor_id, timestamp}
│   │   ├── sensor.schema.ts       — cities, sensor_id unique
│   │   ├── story.schema.ts        — stories, unique {sensor_id, timestamp}
│   │   ├── subscription.schema.ts — subscriptions, unique {account, owner}
│   │   └── index-state.schema.ts  — index_state, key unique
│   └── repositories/
│       ├── datalog.repository.ts
│       ├── measurement.repository.ts
│       ├── sensor.repository.ts
│       ├── story.repository.ts
│       ├── subscription.repository.ts
│       └── index-state.repository.ts
│
├── robonomics/
│   ├── robonomics.module.ts       — DI for BlockIndexer + handlers + tokens
│   ├── robonomics.service.ts      — @polkadot/api connect + reconnect
│   ├── block-indexer.service.ts   — catch-up + realtime + handler dispatch
│   ├── handler-filter.ts          — ENABLED/DISABLED_HANDLERS
│   ├── constants.ts               — DI tokens EVENT_HANDLERS, EXTRINSIC_HANDLERS
│   ├── interfaces/
│   │   ├── chain-event-handler.interface.ts
│   │   └── chain-extrinsic-handler.interface.ts
│   └── handlers/
│       ├── datalog-new-record.handler.ts
│       ├── rws-new-devices.handler.ts
│       ├── rws-extrinsic.handler.ts
│       └── rws-story.handler.ts
│
├── measurement/
│   ├── measurement.module.ts
│   ├── ipfs-fetcher.service.ts             — gateway fallback fetch
│   └── measurement-processor.service.ts    — polling, parsing, sensor upsert
│
├── geocoding/
│   ├── geocoding.module.ts
│   └── geocoding.service.ts                — Nominatim reverse polling
│
├── api/                                    — REST controllers (see api_endpoints.md)
├── metrics/                                — Prometheus
│
├── app.module.ts                  — dynamic build driven by env flags
├── env-bootstrap.ts               — .env / DOTENV_CONFIG_PATH loader
└── main.ts                        — NestJS bootstrap + enableShutdownHooks
```

---

## Datalog statuses

```
NEW (0)            — resultHash is not an IPFS CID; processing is complete
                     (or it is inline JSON parsed by a dedicated handler,
                     e.g. RwsStoryHandler)
IPFS_PENDING (1)   — CID, waiting to be fetched by MeasurementProcessor
PROCESSED (2)      — payload fetched, measurement records created
ERROR (3)          — fetch/parse error, see errorMessage
```

---

## Dependencies

- `@polkadot/api`, `@polkadot/types`, `robonomics-api-augment` — parachain interaction.
- `@nestjs/mongoose`, `mongoose` — MongoDB via the Repository pattern.
- Native `fetch` (Node 18+) — IPFS gateways and Nominatim.
- `@willsoto/nestjs-prometheus`, `prom-client` — metrics (separate module).
