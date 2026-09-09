# REST API

This document describes the **overall design** of the RoSeMAN HTTP layer: bootstrap, versioning, error handling, validation and shared guards. The full endpoint reference is in [api_endpoints.md](./api_endpoints.md).

## Bootstrap

The REST API is started only if `API_ENABLED !== 'false'`. In that case `main.ts` does:

```ts
const app = await NestFactory.create(AppModule);

app.enableCors();
app.setGlobalPrefix('api', { exclude: ['/metrics'] });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();

await app.listen(port);
```

This implies four shared properties:

1. **CORS is open** — `enableCors()` without parameters allows requests from any origin.
2. **Global `/api` prefix** — every controller is mounted under `/api/...`. The exception is the Prometheus endpoint `/metrics` (see [metrics.md](./metrics.md)).
3. **Global DTO validation** — `ValidationPipe` with `whitelist: true, transform: true`: unknown fields in query/body are stripped, types are coerced (`@Type(() => Number)` from `class-transformer` + `@IsInt()` etc.).
4. **Unified error format** via `AllExceptionsFilter`.

## Controllers and versioning

Current controllers (`src/api/`):

| Controller               | Path             | Purpose                                                                     |
| ------------------------ | ---------------- | --------------------------------------------------------------------------- |
| `StatusController`       | `/api/status`    | Indexer state (agents, last-block)                                          |
| `SensorController`       | `/api/sensor`    | V1 — sensor data, cities, messages                                          |
| `SensorV2Controller`     | `/api/v2/sensor` | V2 — `maxdata`, aggregated lists (`list`/`urban`/`markers`), `owner/:owner` |
| `StoryController`        | `/api/v2/story`  | Stories (`list`, `last/:sensor_id`)                                         |
| `ConnectivityController` | `/api/v3`        | Public protocol-aware Connectivity messages                                 |

Versioning is done **through the path, not via `enableVersioning()`** — V2 lives in a separate controller with the `v2/...` prefix. This allows V1 and V2 to share a common service (`SensorService`) while exposing different endpoint signatures.

The full list of paths, methods, query parameters and response formats is in [api_endpoints.md](./api_endpoints.md).

## Response format

The vast majority of endpoints return a wrapper object with a single `result` key:

```json
{ "result": [...] }
```

This makes it easier for clients to move between endpoints and keeps responses uniform. Exceptions exist where the result is structurally more complex — for example, `getList()` returns `{ result: { totalPages, list } }`, and the CSV endpoint returns `text/csv` in the body without a wrapper.

## Validation and DTOs

DTO classes live in `src/api/<module>/dto/`. They use:

- `class-validator` — decorators `@IsInt()`, `@IsString()`, `@IsOptional()`, `@Max()`, `@Min()`, etc.
- `class-transformer` — `@Type(() => Number)` for coercing query strings into numbers.

Because `ValidationPipe` with `whitelist: true` is global, validation and stripping of unknown fields are enabled automatically for every `@Query()` and `@Body()` parameter bound to a DTO class.

## Guards

### DateRangeGuard

File: `src/api/common/guards/date-range.guard.ts`. Protects "heavy" endpoints from requests with an excessively wide time range.

- Reads `start` and `end` from `request.params` (priority) or `request.query`.
- Compares the difference against `MAX_PERIOD_DAYS` (default `31`, overridable via env).
- If exceeded, throws `PayloadTooLargeException(`Max period ${maxDays} days`)` → HTTP 413.

Applied via `@UseGuards(DateRangeGuard)` to endpoints that accept a time range. See the "Guard" column in [api_endpoints.md](./api_endpoints.md).

## Error handling

`AllExceptionsFilter` (`src/api/common/filters/http-exception.filter.ts`) — a global `@Catch()` without arguments — intercepts **any** exception thrown in controllers or services:

- `HttpException` (including `BadRequestException`, `NotFoundException`, `PayloadTooLargeException`, etc.) — status and message come from the exception.
- Any other exception → HTTP 500 with the message `'Internal server error'`.

Response format:

```json
{
  "statusCode": 413,
  "message": "Max period 31 days",
  "timestamp": "2026-04-29T12:34:56.789Z"
}
```

The `message` field is normalized: if the exception carries an object payload (`getResponse()` returns an object), its `message` field is used; otherwise the object itself.

## Controller specifics

### StatusController

`/api/status/agents` — list of agent addresses, read directly from `robonomics.accounts` (env `ROBONOMICS_ACCOUNTS`).

`/api/status/last-block?chain=...` — indexer state. The `chain` parameter is the **key in the `index_state` collection** (currently `polkadot_robonomics`); the default is the current instance's `robonomics.stateKey`. If the record is not found — HTTP 404 with `{ error: 'State not found for chain "<key>"' }`.

### SensorV2Controller — `:type` validation

In the path `/api/v2/sensor/maxdata/:type/:start/:end` the `type` parameter is additionally validated against the regexp `/^[a-z0-9_]+$/`. This guards against injection into field names when building dynamic queries against measurements.

### ConnectivityController — public protocol messages

`GET /api/v3/messages/json` reads the canonical `connectivity_records` collection and returns JSON. It always selects only structurally valid, correctly signed and successfully decoded records that have a materialized `message_json`. Results are sorted by `{ recorded_at: -1, _id: -1 }` so records with the same millisecond timestamp have a deterministic order.

All query parameters are optional. `start` and `end` can be supplied
independently:

| Parameter          | Meaning                                                                      |
| ------------------ | ---------------------------------------------------------------------------- |
| `limit`            | Page size, `1..1000`, default `1000`                                         |
| `cursor`           | Opaque `next_cursor` returned by the previous page                           |
| `start`            | Optional inclusive lower bound in Unix milliseconds (`recorded_at >= start`) |
| `end`              | Optional exclusive upper bound in Unix milliseconds (`recorded_at < end`)    |
| `sensor_id`        | Lowercase 64-character Ed25519 public-key hex                                |
| `owner`            | SS58 owner address                                                           |
| `payload_type`     | `urban` or `insight`                                                         |
| `measurement_type` | Public measurement type such as `temperature` or `pm10`                      |

Cursor pagination starts with a request that does not include `cursor`. For
example, this request selects the Samara calendar day of 7 September 2026 and
limits the page to 1000 items:

```text
http://127.0.0.1:3001/api/v3/messages/json?start=1788724800000&end=1788811200000&limit=1000
```

When more records are available, the response contains an opaque 28-character
URL-safe token in `result.next_cursor`. It compactly encodes the format version,
millisecond timestamp and MongoDB ObjectId. Pass it unchanged in the next
request while keeping the same filters and page limit:

```text
http://127.0.0.1:3001/api/v3/messages/json?start=1788724800000&end=1788811200000&limit=1000&cursor=<NEXT_CURSOR>
```

Continue until `next_cursor` is `null`, which marks the last page. The cursor
must not be decoded or edited. Pagination currently moves forward only; the API
does not return a previous-page cursor. Every page request must repeat the same
filters and whichever date boundaries were used on the first page. If both
boundaries are present, `start` must be less than `end`; there is no maximum
range restriction for this endpoint.

Response example:

```json
{
  "result": {
    "items": [
      {
        "sensorId": "4F...",
        "timestamp": "1788429600123",
        "message": {
          "metadata": {
            "owner": "4H..."
          },
          "urban": {
            "public": [
              {
                "bme280": {
                  "temperature": {
                    "celsius": 22.5
                  }
                }
              }
            ]
          }
        }
      }
    ],
    "next_cursor": "AgAAAaBmtgV7aLla4HeWaWJAVmoB"
  }
}
```

Each item is a public JSON view of `crypto.v1.SignedEnvelope`, with its binary `message` field materialized as `core.v1.Message` protobuf JSON during indexing. The top-level envelope fields `nonce` and `signature` are omitted; clients that need the complete signed envelope must use the protobuf endpoints. API reads do not decode `message_raw`. The envelope `timestamp` remains a decimal string so the protocol `uint64` value is not rounded by JavaScript. `sensorId` and `message.metadata.owner` use SS58 with `CPS_OWNER_SS58_PREFIX`; byte fields inside encrypted private sections use standard base64. If the original message contains `urban.private` or `insight.private`, its encrypted sections are included unchanged in protobuf JSON form; the API never decrypts them. Pagination metadata remains outside the envelope items. Records indexed before `message_json` was introduced require canonical backfill with `--force` before they appear in this endpoint.

### Latest Connectivity message per sensor

`GET /api/v3/messages/latest/json` returns at most one JSON item for each `sensor_id`: the
newest valid, correctly signed and decoded message inside the requested date
range. Sensors without matching messages in `[start, end)` are omitted. Items
have exactly the same public JSON format as `GET /api/v3/messages/json` and
are ordered from newest to oldest.

The endpoint requires `start` and `end` in Unix milliseconds and applies the
same maximum range of 24 hours. Optional filters are `sensor_id`, `owner`,
`payload_type` and `measurement_type`. It does not use `limit` or `cursor` and
does not return `next_cursor`.

Example:

```text
http://127.0.0.1:3001/api/v3/messages/latest/json?start=1788724800000&end=1788811200000
```

Response shape:

```json
{
  "result": {
    "items": [
      {
        "sensorId": "4F...",
        "timestamp": "1788429600123",
        "message": {}
      }
    ]
  }
}
```

### Connectivity protobuf responses

- `GET /api/v3/messages` returns a protobuf page with the same parameters, filters, order, and `limit` constraint as `/api/v3/messages/json`.
- `GET /api/v3/messages/latest` returns the latest sensor messages as protobuf, with the same filters and required range of at most 24 hours as `/api/v3/messages/latest/json`.

A successful response has HTTP status `200`, `Content-Type: application/protobuf`, and a binary `crypto.v1.SignedEnvelopeBatch` body defined by the existing Connectivity Protocol (`crypto/v1/envelope.proto`). Its `batch` field contains a list of `SignedEnvelope` messages. An empty list is encoded as an empty protobuf batch: HTTP `200` with a zero-byte body. Validation errors (`400`, `413`) and server errors retain the standard JSON API format.

For paginated responses, the `X-Next-Cursor` header contains the opaque cursor for the next request. Pass it unchanged as the `cursor` query parameter and keep all other filters. An absent header marks the last page. Browsers can access this header through `Access-Control-Expose-Headers: X-Next-Cursor`. The `latest` endpoint does not return a cursor.

Example that saves the binary response and headers:

```sh
curl -D headers.txt -o messages.pb 'http://127.0.0.1:3001/api/v3/messages?limit=100'
curl -o latest.pb 'http://127.0.0.1:3001/api/v3/messages/latest?start=1788724800000&end=1788811200000'
```

Frontend decoding example with `@bufbuild/protobuf`:

```ts
import { fromBinary } from '@bufbuild/protobuf';
import { SignedEnvelopeBatchSchema } from '@buf/airalab_connectivity-protocol.bufbuild_es/crypto/v1/envelope_pb.js';

const response = await fetch('/api/v3/messages?limit=100');
if (!response.ok) throw new Error(`HTTP ${response.status}`);
const { batch } = fromBinary(
  SignedEnvelopeBatchSchema,
  new Uint8Array(await response.arrayBuffer()),
);
const nextCursor = response.headers.get('X-Next-Cursor'); // string | null
// batch[i].message contains the original Uint8Array used for signature verification.
// Verify the signature before decoding the nested Message.
```

## Full endpoint list

See **[api_endpoints.md](./api_endpoints.md)**.
