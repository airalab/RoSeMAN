# REST API design

This document describes the shared behavior and versioning of the RoSeMAN HTTP API. For request parameters and response shapes of every route, see the [endpoint reference](./api_endpoints.md).

## API generations

The newest API is listed first throughout the documentation.

| Generation | Base path                    | Scope                                                              | Status                     |
| ---------- | ---------------------------- | ------------------------------------------------------------------ | -------------------------- |
| V3         | `/api/v3`                    | Verified Connectivity Protocol messages in JSON and protobuf       | Current protocol-aware API |
| V2         | `/api/v2`                    | Aggregated sensor views, owner relationships and stories           | Current legacy-data API    |
| Legacy     | `/api/sensor`, `/api/status` | Original sensor exports, measurements, messages and indexer status | Retained for compatibility |

Versioning is path-based. The application does not use NestJS `enableVersioning()`: each generation is mounted by its controller prefix. Adding a new generation therefore does not change the behavior of older routes.

## Starting and addressing the API

The HTTP server starts unless `API_ENABLED=false`. The default port is `3000`; `PORT` can override it through application configuration.

All controller routes have the global `/api` prefix. The only exception is the Prometheus endpoint at `/metrics`, documented separately in [metrics.md](./metrics.md).

Examples in this documentation use:

```text
http://127.0.0.1:3000/api
```

The bootstrap configuration in `src/main.ts` also:

- enables CORS with NestJS defaults;
- enables DTO transformation and validation;
- strips properties that are not declared by the bound DTO;
- installs the shared exception filter;
- enables graceful shutdown hooks.

## Time and range conventions

The API generations do not use the same timestamp unit. Clients should choose the unit from the requested route, not from the data being displayed.

| Routes               | Timestamp unit    | Range semantics                                             | Maximum range                                           |
| -------------------- | ----------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| V3 `/messages*`      | Unix milliseconds | `[start, end)`; `start` is inclusive and `end` is exclusive | None for paginated routes; 24 hours for `latest` routes |
| V2 sensor routes     | Unix seconds      | `[start, end]`; both bounds are inclusive                   | `MAX_PERIOD_DAYS`, default 31 days                      |
| V2 story routes      | Unix seconds      | `[start, end]`; either bound may be omitted                 | No guard-based limit                                    |
| Legacy sensor routes | Unix seconds      | `[start, end]`; both bounds are inclusive                   | `MAX_PERIOD_DAYS`, default 31 days                      |

For all bounded V3 requests, `start` must be less than `end`. The V2 and legacy `DateRangeGuard` only enforces the maximum span; integer route parameters are validated separately by `ParseIntPipe`.

## Responses

### JSON

JSON endpoints normally return an object with a top-level `result` property:

```json
{
  "result": []
}
```

Pagination metadata stays inside `result`. For example, the V3 message list returns:

```json
{
  "result": {
    "items": [],
    "next_cursor": null
  }
}
```

The V2 sensor-by-owner view is the only JSON route with an additional top-level property: it returns `{ "result": [...], "sensor": ... }`.

### Binary and text

- V3 protobuf endpoints return `application/protobuf` and a `crypto.v1.SignedEnvelopeBatch` body.
- The legacy CSV endpoint returns `text/csv; charset=utf-8`; its content is tab-separated despite the `.csv` filename.

### Empty results

JSON list endpoints return an empty array, object or `null` according to their documented response shape. An empty protobuf batch is a successful HTTP `200` response with a zero-byte body.

## Validation and errors

DTOs in `src/api/<module>/dto/` use `class-validator` and `class-transformer`. Query-string numbers are transformed to numbers where the DTO declares `@Type(() => Number)`. Undeclared query or body properties are removed because the global `ValidationPipe` uses `whitelist: true`.

Route parameters such as `:start` and `:end` use `ParseIntPipe` where applicable. Validation failures return HTTP `400`.

`AllExceptionsFilter` converts every exception to the same JSON envelope:

```json
{
  "statusCode": 400,
  "message": "start must be less than end",
  "timestamp": "2026-09-10T12:34:56.789Z"
}
```

For NestJS validation errors, `message` can be an array of strings. If an `HttpException` contains a custom object without a `message` property, that object is returned as the value of `message`. Unexpected errors return HTTP `500` with `"Internal server error"`.

`DateRangeGuard` protects the V2 and legacy sensor routes that accept a period. It reads `start` and `end` from route parameters first and then from the query string. A span greater than `MAX_PERIOD_DAYS` produces HTTP `413`:

```json
{
  "statusCode": 413,
  "message": "Max period 31 days",
  "timestamp": "2026-09-10T12:34:56.789Z"
}
```

## V3: Connectivity Protocol API

The V3 API reads the canonical `connectivity_records` collection. Public results include only records that:

- have a valid envelope structure;
- have a valid signature;
- were decoded successfully;
- have a materialized `message_json` object.

Records are ordered by `recorded_at` descending and then MongoDB `_id` descending. The secondary key makes pagination deterministic when multiple records have the same millisecond timestamp.

### Available representations

Each V3 selection has a default protobuf representation and an explicit JSON representation:

| Selection                 | Protobuf (default)            | JSON                               |
| ------------------------- | ----------------------------- | ---------------------------------- |
| Paginated messages        | `GET /api/v3/messages`        | `GET /api/v3/messages/json`        |
| Latest message per sensor | `GET /api/v3/messages/latest` | `GET /api/v3/messages/latest/json` |

The routes without a format suffix return protobuf. Their `/json` variants are intended for clients that cannot consume protobuf. Paired routes use the same filters, ordering and range rules; protobuf preserves the original signed envelope fields required for independent signature verification.

### Protobuf responses

The binary body is `crypto.v1.SignedEnvelopeBatch` from `crypto/v1/envelope.proto`. Each `batch` item contains the original `sensor_id`, `nonce`, `message` and `signature`. Verify Ed25519 over the exact `sensor_id || nonce || message` bytes before decoding the nested message; the measurement timestamp is protected inside the signed `message` bytes.

### Cursor pagination

Start a paginated request against the default protobuf endpoint without `cursor`:

```text
GET /api/v3/messages?start=1788724800000&end=1788811200000&limit=100
```

If more records exist, JSON returns an opaque token in `result.next_cursor`; protobuf returns the same token in `X-Next-Cursor`. Pass it unchanged as the next request's `cursor` and repeat the original filters, date boundaries and limit. A `null` JSON cursor or absent protobuf header marks the last page.

Pagination moves only from newer to older records. Cursors are implementation details: clients should neither decode nor edit them.

The protobuf list route exposes `X-Next-Cursor` through `Access-Control-Expose-Headers`, so browser clients can read it.

### Protobuf decoding

```sh
curl -D headers.txt -o messages.pb \
  'http://127.0.0.1:3000/api/v3/messages?limit=100'
```

Example with `@bufbuild/protobuf`:

```ts
import { fromBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';

const response = await fetch('/api/v3/messages?limit=100');
if (!response.ok) throw new Error(`HTTP ${response.status}`);

const { batch } = fromBinary(
  SignedEnvelopeBatchSchema,
  new Uint8Array(await response.arrayBuffer()),
);
const nextCursor = response.headers.get('X-Next-Cursor');
```

### JSON envelope view

The `/json` endpoints return items in this shape:

```json
{
  "sensorId": "4F...",
  "message": {
    "metadata": {
      "nodeId": "42",
      "timestamp": "1788429600123"
    },
    "urban": {
      "public": []
    }
  }
}
```

The JSON view omits the envelope-level `nonce` and `signature`. The nested binary `message` is materialized as protobuf JSON for `core.v1.Message`; its `metadata.nodeId` and `metadata.timestamp` uint64 values are decimal strings, as required by protobuf JSON.

`sensorId` is SS58-encoded with `CPS_SENSOR_SS58_PREFIX`. Byte fields in encrypted private sections use standard base64. Private sections are returned in their encrypted protobuf JSON form and are never decrypted by the API.

Records indexed before `message_json` was introduced must be canonically backfilled with `--force` before they can appear in the public V3 API.

## V2 API

V2 consists of two controllers:

| Controller           | Prefix           | Responsibility                                                               |
| -------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `SensorV2Controller` | `/api/v2/sensor` | Aggregated sensor lists, marker data, owner relationships and sensor history |
| `StoryController`    | `/api/v2/story`  | Paginated stories and the latest story for a sensor                          |

V2 sensor routes continue to use the legacy `measurements` collection and Unix-second timestamps. The `maxdata` measurement type is restricted to lowercase letters, digits and underscores because it becomes part of a dynamic measurement field path.

Owner-based sensor results derive ownership from measurement records, not from blockchain subscriptions. The exact time scope differs by endpoint and is called out in the [endpoint reference](./api_endpoints.md#v2-api).

## Legacy API

The unversioned controllers are retained for existing clients:

| Controller         | Prefix        | Responsibility                                                                        |
| ------------------ | ------------- | ------------------------------------------------------------------------------------- |
| `SensorController` | `/api/sensor` | Cities, area queries, text export, measurement types, messages and per-sensor history |
| `StatusController` | `/api/status` | Configured indexer agents and last processed block                                    |

These routes use data from the legacy indexing pipeline. New Connectivity Protocol integrations should use V3.

## Endpoint reference

See [api_endpoints.md](./api_endpoints.md) for the complete V3 → V2 → legacy route list, parameters and response shapes.
