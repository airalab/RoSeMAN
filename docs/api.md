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

| Controller           | Path                | Purpose                                             |
|----------------------|---------------------|-----------------------------------------------------|
| `StatusController`   | `/api/status`       | Indexer state (agents, last-block)                  |
| `SensorController`   | `/api/sensor`       | V1 — sensor data, cities, messages                  |
| `SensorV2Controller` | `/api/v2/sensor`    | V2 — `maxdata`, aggregated lists, `urban`           |
| `StoryController`    | `/api/v2/story`     | Stories (`list`, `last/:sensor_id`)                 |

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

`/api/status/last-block?chain=...` — indexer state. The `chain` parameter is the **key in the `index_state` collection** (e.g. `polkadot_robonomics`, `kusama_robonomics`); the default is the current instance's `robonomics.stateKey`. If the record is not found — HTTP 404 with `{ error: 'State not found for chain "<key>"' }`.

### SensorV2Controller — `:type` validation

In the path `/api/v2/sensor/maxdata/:type/:start/:end` the `type` parameter is additionally validated against the regexp `/^[a-z0-9_]+$/`. This guards against injection into field names when building dynamic queries against measurements.

## Full endpoint list

See **[api_endpoints.md](./api_endpoints.md)**.
