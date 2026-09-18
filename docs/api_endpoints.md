# RoSeMAN API endpoint reference

This page documents every HTTP route in newest-first order: V3, V2, then unversioned legacy endpoints. Shared bootstrap, validation, errors and versioning are described in [api.md](./api.md).

## Conventions

- Base URL in examples: `http://127.0.0.1:3000`.
- All routes use `GET` and begin with `/api`.
- Unless stated otherwise, successful JSON responses use `{ "result": ... }`.
- V3 timestamps are Unix milliseconds; V2 and legacy timestamps are Unix seconds.
- V3 ranges are `[start, end)`; V2 and legacy database ranges include both bounds.
- V2 and legacy sensor ranges are limited by `MAX_PERIOD_DAYS` (31 days by default).
- Path values must be URL-encoded when they contain characters that are not safe in a path segment.

## Endpoint index

| Generation | Method and path                                | Response                           |
| ---------- | ---------------------------------------------- | ---------------------------------- |
| V3         | `GET /api/v3/messages`                         | Paginated protobuf messages        |
| V3         | `GET /api/v3/messages/latest`                  | Latest protobuf message per sensor |
| V3         | `GET /api/v3/messages/json`                    | Paginated JSON messages            |
| V3         | `GET /api/v3/messages/latest/json`             | Latest JSON message per sensor     |
| V2         | `GET /api/v2/sensor/maxdata/:type/:start/:end` | Maximum values by sensor           |
| V2         | `GET /api/v2/sensor/list/:start/:end`          | Sensor list                        |
| V2         | `GET /api/v2/sensor/urban/:start/:end`         | Urban sensor list                  |
| V2         | `GET /api/v2/sensor/markers/:start/:end`       | Map marker list                    |
| V2         | `GET /api/v2/sensor/owner/:owner`              | Current sensors by owner           |
| V2         | `GET /api/v2/sensor/:sensor/:start/:end`       | Sensor and owner-related data      |
| V2         | `GET /api/v2/story/list`                       | Paginated stories                  |
| V2         | `GET /api/v2/story/last/:sensor_id`            | Latest story for a sensor          |
| Legacy     | `GET /api/sensor/cities`                       | Cities grouped by location         |
| Legacy     | `GET /api/sensor/json`                         | Area or city sensor data           |
| Legacy     | `GET /api/sensor/csv/:start/:end/:city`        | Tab-separated sensor export        |
| Legacy     | `GET /api/sensor/measurements/:start/:end`     | Measurement types                  |
| Legacy     | `GET /api/sensor/messages/:start/:end`         | User messages                      |
| Legacy     | `GET /api/sensor/:sensor/:start/:end`          | Sensor data                        |
| Legacy     | `GET /api/status/agents`                       | Configured agents                  |
| Legacy     | `GET /api/status/last-block`                   | Last indexed block                 |

## V3 API

- Controller: `src/api/connectivity/connectivity.controller.ts`
- Prefix: `/api/v3`

All V3 message routes return only structurally valid, correctly signed and successfully decoded Connectivity Protocol records with materialized JSON. Results are ordered from newest to oldest.

### Shared V3 filters

| Query parameter    | Required              | Type and validation                               | Meaning                                                      |
| ------------------ | --------------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| `start`            | List: no; latest: yes | Integer, `0..8640000000000000`                    | Inclusive `recorded_at` lower bound in Unix milliseconds     |
| `end`              | List: no; latest: yes | Integer, `0..8640000000000000`                    | Exclusive `recorded_at` upper bound in Unix milliseconds     |
| `sensor_id`        | No                    | 64 lowercase hexadecimal characters               | Raw Ed25519 public key used by the indexed record            |
| `node_id`          | No                    | Canonical decimal uint64                          | Robonomics CPS NodeId from signed message metadata            |
| `payload_type`     | No                    | `urban` or `insight`                              | Decoded message payload branch                               |
| `measurement_type` | No                    | Up to 64 lowercase letters, digits or underscores | Public measurement type, for example `temperature` or `pm10` |

The paginated routes allow either date boundary to be supplied independently and do not impose a maximum range. When both are present, `start < end` is required. The latest routes require both boundaries and allow at most 24 hours.

### Shared pagination parameters

| Query parameter | Required | Type and validation                              | Default | Meaning                          |
| --------------- | -------- | ------------------------------------------------ | ------- | -------------------------------- |
| `limit`         | No       | Integer, `1..1000`                               | `1000`  | Maximum items in the page        |
| `cursor`        | No       | Opaque URL-safe string returned by this endpoint | —       | Position after the previous page |

### `GET /api/v3/messages`

**Purpose.** Returns a cursor-paginated page of complete signed Connectivity Protocol envelopes. This is the default representation of the message-list endpoint.

**Parameters.** Accepts all [shared V3 filters](#shared-v3-filters) and [shared pagination parameters](#shared-pagination-parameters).

**Response.** HTTP `200`, `Content-Type: application/protobuf`. The body is `crypto.v1.SignedEnvelopeBatch`. If another page exists, the response includes:

```text
X-Next-Cursor: <opaque cursor>
Access-Control-Expose-Headers: X-Next-Cursor
```

An absent `X-Next-Cursor` header marks the last page. An empty result is a valid zero-byte body.

**Notes.** Repeat all filters and `limit` when following a cursor, and do not decode or modify the token. The batch contains original `sensor_id`, `message`, `nonce` and `signature` bytes. Verify the signature over `sensor_id || nonce || message` before decoding the nested message. A download example and frontend decoder are in [api.md](./api.md#protobuf-decoding).

### `GET /api/v3/messages/latest`

**Purpose.** Returns at most one complete signed envelope per `sensor_id`: the newest matching message in the requested period. This is the default representation of the latest-message endpoint.

**Parameters.** Accepts all [shared V3 filters](#shared-v3-filters). `start` and `end` are required, must satisfy `start < end`, and may span at most 24 hours. This endpoint has no `limit` or `cursor`.

**Response.** HTTP `200`, `Content-Type: application/protobuf`; body type `crypto.v1.SignedEnvelopeBatch`. An empty selection produces a zero-byte body.

**Notes.** Sensors with no matching message are omitted. Batch items are sorted from newest to oldest. This route has no pagination and never returns `X-Next-Cursor`.

### `GET /api/v3/messages/json`

**Purpose.** Returns the same cursor-paginated message selection as `/api/v3/messages`, materialized as protobuf JSON for clients that do not consume the default binary format.

**Parameters.** Accepts all [shared V3 filters](#shared-v3-filters) and [shared pagination parameters](#shared-pagination-parameters).

**Response.** HTTP `200`, `application/json`:

```json
{
  "result": {
    "items": [
      {
        "sensorId": "4F...",
        "message": {
          "metadata": {
            "nodeId": "42",
            "timestamp": "1788429600123"
          },
          "urban": { "public": [] }
        }
      }
    ],
    "next_cursor": "AgAAAaBmtgV7aLla4HeWaWJAVmoB"
  }
}
```

`next_cursor` is `null` on the last page. The protobuf JSON uint64 fields `message.metadata.nodeId` and `message.metadata.timestamp` are decimal strings. The JSON item omits the signed envelope's `nonce` and `signature`.

**Notes.** Repeat all filters and `limit` when following a cursor. Do not decode or modify the token. See [V3 design details](./api.md#v3-connectivity-protocol-api) for encoding and private-section behavior.

### `GET /api/v3/messages/latest/json`

**Purpose.** Returns the same latest-per-sensor selection as `/api/v3/messages/latest`, materialized as protobuf JSON.

**Parameters.** Accepts all [shared V3 filters](#shared-v3-filters). `start` and `end` are required, must satisfy `start < end`, and may span at most 24 hours. This endpoint has no `limit` or `cursor`.

**Response.** HTTP `200`, `application/json`:

```json
{
  "result": {
    "items": [
      {
        "sensorId": "4F...",
        "message": {
          "metadata": {
            "nodeId": "42",
            "timestamp": "1788429600123"
          }
        }
      }
    ]
  }
}
```

**Notes.** Sensors with no matching message are omitted. Items have the same JSON format as `/api/v3/messages/json` and are sorted from newest to oldest.

## V2 API

### V2 sensor endpoints

- Controller: `src/api/sensor/sensor-v2.controller.ts`
- Prefix: `/api/v2/sensor`

All `start` and `end` path parameters in this section are Unix seconds parsed as integers. Database queries include both bounds. Routes with a date range return HTTP `413` when it exceeds `MAX_PERIOD_DAYS`.

### `GET /api/v2/sensor/maxdata/:type/:start/:end`

**Purpose.** Returns the maximum value of one measurement type for every sensor with matching data in the period.

**Parameters.** `type` is a path parameter matching `^[a-z0-9_]+$`, such as `pm10` or `temperature`. `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`, keyed by sensor ID:

```json
{
  "result": {
    "sensor-id": {
      "model": 1,
      "geo": { "lat": 53.2, "lng": 50.1 },
      "timestamp": 1788429600,
      "value": 12.4
    }
  }
}
```

**Notes.** The associated model, location and timestamp come from the record containing that sensor's maximum value. `geo` may be absent.

### `GET /api/v2/sensor/list/:start/:end`

**Purpose.** Lists sensors that have sensor-data measurements in the period.

**Parameters.** `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`; `result` is an array of the latest record per sensor:

```json
{
  "result": [
    {
      "sensor_id": "sensor-id",
      "model": 1,
      "geo": { "lat": 53.2, "lng": 50.1 },
      "donated_by": "",
      "owner": "4H...",
      "timestamp": 1788429600
    }
  ]
}
```

**Notes.** `geo` and `owner` may be absent. Ownership is read from the latest measurement in the requested period.

### `GET /api/v2/sensor/urban/:start/:end`

**Purpose.** Lists Urban sensors with measurements in the period.

**Parameters.** `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`; `result` uses the same item shape as `/api/v2/sensor/list/:start/:end`.

**Notes.** A sensor is included when its latest `device_model` in the period contains `urban` case-insensitively or is absent. The `device_model` value itself is not returned.

### `GET /api/v2/sensor/markers/:start/:end`

**Purpose.** Builds the sensor list used for map markers while grouping owner-related devices.

**Parameters.** `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`; each `result` item contains the sensor-list fields plus `device_model`, optional `owner`, and—for Urban-classified entries—a `sensors` array of the owner's other devices.

```json
{
  "result": [
    {
      "sensor_id": "urban-sensor",
      "model": 1,
      "donated_by": "",
      "device_model": "urban",
      "owner": "4H...",
      "timestamp": 1788429600,
      "sensors": [{ "sensor_id": "insight-sensor", "device_model": "insight" }]
    }
  ]
}
```

**Notes.** Results include Urban sensors, sensors without `device_model`, and Insight sensors whose owner has no Urban sensor. An Insight sensor without an owner is also included. The `sensors` field excludes the current sensor.

### `GET /api/v2/sensor/owner/:owner`

**Purpose.** Lists sensor IDs whose current owner equals the supplied owner.

**Parameters.** `owner` is a required path string. URL-encode the value when necessary.

**Response.** HTTP `200`:

```json
{
  "result": ["sensor-a", "sensor-b"]
}
```

**Notes.** “Current” means the `owner` field of each sensor's newest measurement across all time, not only a requested period. The list is sorted and contains unique sensor IDs.

### `GET /api/v2/sensor/:sensor/:start/:end`

**Purpose.** Returns one sensor's measurements plus measurements from sensors attributed to the same owner during the period.

**Parameters.** `sensor` is a required sensor ID. `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`:

```json
{
  "result": [
    {
      "data": { "temperature": 22.5 },
      "timestamp": 1788429600,
      "geo": { "lat": 53.2, "lng": 50.1 }
    }
  ],
  "sensor": {
    "owner": "4H...",
    "sensors": [{ "sensor_id": "sensor-id", "device_model": "urban" }],
    "data": {
      "sensor-id": []
    }
  }
}
```

**Notes.** Measurements in each array are chronological. `geo` and `device_model` may be absent. If the requested sensor has no owner in the period, `sensor` is `null` and `result` still contains its available data.

### V2 story endpoints

- Controller: `src/api/story/story.controller.ts`
- Prefix: `/api/v2/story`

### `GET /api/v2/story/list`

**Purpose.** Returns stories in reverse chronological order with page metadata.

**Parameters.** All parameters are optional:

| Query parameter | Type and validation | Default | Meaning                           |
| --------------- | ------------------- | ------- | --------------------------------- |
| `limit`         | Integer, `1..50`    | `50`    | Stories per page                  |
| `page`          | Integer, `>=1`      | `1`     | One-based page number             |
| `start`         | Integer, `>=0`      | —       | Inclusive Unix-second lower bound |
| `end`           | Integer, `>=0`      | —       | Inclusive Unix-second upper bound |

**Response.** HTTP `200`:

```json
{
  "result": {
    "totalPages": 1,
    "list": [
      {
        "author": "Alice",
        "sensor_id": "sensor-id",
        "message": "Example story",
        "timestamp": 1788429600,
        "date": "2026-09-03",
        "icon": ""
      }
    ]
  }
}
```

**Notes.** `date` can be `null`. When there are no matching stories, `totalPages` is `0` and `list` is empty. Either date bound may be supplied independently.

### `GET /api/v2/story/last/:sensor_id`

**Purpose.** Returns the newest story for one sensor.

**Parameters.** `sensor_id` is a required path string.

**Response.** HTTP `200`; `result` is the story or `null`:

```json
{
  "result": {
    "author": "Alice",
    "message": "Example story",
    "date": null,
    "timestamp": 1788429600,
    "icon": ""
  }
}
```

**Notes.** Unlike the list endpoint, this response does not repeat `sensor_id`.

## Legacy API

### Legacy sensor endpoints

- Controller: `src/api/sensor/sensor.controller.ts`
- Prefix: `/api/sensor`

All range path parameters below are integer Unix seconds. Ranges include both bounds and are limited by `MAX_PERIOD_DAYS` (31 days by default).

### `GET /api/sensor/cities`

**Purpose.** Returns known cities grouped by country and region.

**Parameters.** None.

**Response.** HTTP `200`:

```json
{
  "result": {
    "Russia": {
      "Samara Oblast": ["Samara"]
    }
  }
}
```

**Notes.** Group names and cities come from stored sensor metadata.

### `GET /api/sensor/json`

**Purpose.** Returns sensor measurements in a geographic rectangle or for sensors assigned to a city, grouped by sensor ID.

**Parameters.** Query parameters:

| Query parameter | Required                 | Type                        | Meaning                                      |
| --------------- | ------------------------ | --------------------------- | -------------------------------------------- |
| `start`         | Yes                      | Integer Unix seconds, `>=0` | Inclusive lower bound                        |
| `end`           | Yes                      | Integer Unix seconds, `>=0` | Inclusive upper bound                        |
| `bound`         | One of `bound` or `city` | `lat1,lng1\|lat2,lng2`      | Rectangle corners; their order is normalized |
| `city`          | One of `bound` or `city` | String                      | City whose known sensor IDs are selected     |

**Response.** HTTP `200`, keyed by sensor ID:

```json
{
  "result": {
    "sensor-id": [
      {
        "data": { "pm10": 12.4 },
        "timestamp": 1788429600,
        "geo": { "lat": 53.2, "lng": 50.1 }
      }
    ]
  }
}
```

**Notes.** At least one selection parameter is required. If both are supplied, `bound` takes precedence. `geo` may be absent. An unknown city returns an empty object.

### `GET /api/sensor/csv/:start/:end/:city`

**Purpose.** Downloads measurements for sensors assigned to a city.

**Parameters.** `start` and `end` are required integer Unix-second path parameters. `city` is a required, URL-encoded city name.

**Response.** HTTP `200`, `Content-Type: text/csv; charset=utf-8`, with an attachment filename `sensors_<city>_<start>_<end>.csv`.

```text
timestamp\tsensor_id\tgeo\tpm10\tpm25\t<other measurement fields>
```

**Notes.** The file is tab-separated. Dates in its first column use UTC `DD.MM.YYYY HH:mm`. `pm10` and `pm25` columns are always present; other measurement keys are appended alphabetically. An empty selection returns only the five fixed headers.

### `GET /api/sensor/measurements/:start/:end`

**Purpose.** Returns the distinct measurement field names observed in sensor-data records during the period.

**Parameters.** `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`:

```json
{
  "result": ["humidity", "pm10", "temperature"]
}
```

**Notes.** Names are sorted alphabetically.

### `GET /api/sensor/messages/:start/:end`

**Purpose.** Returns user-message records (`model === MESSAGE`) in the period.

**Parameters.** `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`:

```json
{
  "result": [
    {
      "id": "sensor-id",
      "message": "Example message",
      "timestamp": 1788429600,
      "geo": { "lat": 53.2, "lng": 50.1 },
      "author": "Alice",
      "images": []
    }
  ]
}
```

**Notes.** `geo` may be absent. Invalid or absent `message`, `username` and `images` values are normalized to an empty string or empty array.

### `GET /api/sensor/:sensor/:start/:end`

**Purpose.** Returns measurements for one sensor in chronological order.

**Parameters.** `sensor` is a required sensor ID. `start` and `end` are required integer Unix-second path parameters.

**Response.** HTTP `200`:

```json
{
  "result": [
    {
      "data": { "temperature": 22.5 },
      "timestamp": 1788429600,
      "geo": { "lat": 53.2, "lng": 50.1 }
    }
  ]
}
```

**Notes.** `geo` may be absent. Only sensor-data models are included.

### Legacy status endpoints

- Controller: `src/api/status/status.controller.ts`
- Prefix: `/api/status`

### `GET /api/status/agents`

**Purpose.** Returns agent addresses configured for the current process.

**Parameters.** None.

**Response.** HTTP `200`:

```json
{
  "result": ["4H..."]
}
```

**Notes.** Values come from `ROBONOMICS_ACCOUNTS`. If none are configured, the result is an empty array.

### `GET /api/status/last-block`

**Purpose.** Returns the last processed block stored for one index-state key.

**Parameters.** Optional `chain` query string. The default is the current process's `robonomics.stateKey`, falling back to `polkadot_robonomics`.

**Response.** HTTP `200`:

```json
{
  "result": 12345678
}
```

**Notes.** An unknown key returns HTTP `404` using the shared error envelope.

## Summary

- Total endpoints: 20.
- HTTP methods: `GET` only.
- V3 endpoints: 4.
- V2 endpoints: 8 (6 sensor and 2 story).
- Legacy endpoints: 8 (6 sensor and 2 status).
- Controllers live in `ConnectivityModule`, `SensorModule`, `StoryModule` and `StatusModule`.
