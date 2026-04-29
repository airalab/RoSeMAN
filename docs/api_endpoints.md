# RoSeMAN API Endpoints

> Global prefix: `/api` (configured in `src/main.ts`)

## Status Controller

**File:** `src/api/status/status.controller.ts`
**Prefix:** `status`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/status/agents` | `getAgents()` | List of agent addresses from configuration |
| GET | `/api/status/last-block` | `getLastBlock()` | Number of the last processed block. Query: `?chain=` (default `polkadot_robonomics`) |

## Sensor Controller (V1)

**File:** `src/api/sensor/sensor.controller.ts`
**Prefix:** `sensor`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/sensor/cities` | `getCities()` | List of cities grouped by countries and regions |
| GET | `/api/sensor/json` | `getSensorJson()` | Sensor data from a GPS area or city for a time range. Query: `?start=&end=` (required) + `&bound=lat1,lng1\|lat2,lng2` or `&city=`. Guard: `DateRangeGuard` |
| GET | `/api/sensor/csv/:start/:end/:city` | `getSensorCsv()` | CSV (TSV) file with city sensor data for a time range. Headers: timestamp, sensor_id, geo, pm10, pm25, + dynamic. Guard: `DateRangeGuard` |
| GET | `/api/sensor/measurements/:start/:end` | `getMeasurementTypes()` | Unique measurement types for the period (unix timestamps). Guard: `DateRangeGuard` |
| GET | `/api/sensor/messages/:start/:end` | `getMessages()` | Messages (model=MESSAGE) for the period. Returns id, message, author, images, geo. Guard: `DateRangeGuard` |
| GET | `/api/sensor/:sensor/:start/:end` | `getSensorData()` | Sensor data for the period (unix timestamps). Guard: `DateRangeGuard` |

## Sensor Controller (V2)

**File:** `src/api/sensor/sensor-v2.controller.ts`
**Prefix:** `v2/sensor`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/v2/sensor/maxdata/:type/:start/:end` | `getMaxData()` | Maximum measurement values of the given type for each sensor in the period. `:type` is validated by `/^[a-z0-9_]+$/`. Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/list/:start/:end` | `getSensorList()` | List of sensors with data for the given period. Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/urban/:start/:end` | `getUrbanSensorList()` | List of sensors without `co2` measurements for the period (same as `list`, but filtered). Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/:sensor/:start/:end` | `getSensorDataWithOwner()` | Sensor data for the period + data of all sensors with the same owner. Response: `{ result, sensor: { owner, sensors, data } }`. Guard: `DateRangeGuard` |

## Story Controller (V2)

**File:** `src/api/story/story.controller.ts`
**Prefix:** `v2/story`

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/api/v2/story/list` | `getList()` | Page of stories (sorted by timestamp desc). Query: `?limit=` (max 50, default 50), `?page=` (default 1), `?start=`, `?end=` — all optional. Response: `{ totalPages, list }` |
| GET | `/api/v2/story/last/:sensor_id` | `getLast()` | Last story for the given sensor. Response: `{ result: { author, message, date, timestamp, icon } }` or `{ result: null }` |

## Summary

- **Total endpoints:** 14
- **All methods:** GET only
- **Versioning:** V2 is implemented in a separate controller with the `v2/sensor` prefix
- **Controllers with endpoints** live in `StatusModule`, `SensorModule`, `StoryModule`
- The `RobonomicsModule`, `MeasurementModule`, `GeocodingModule` modules are loaded conditionally (`INDEXER_ENABLED`) and contain no HTTP controllers
