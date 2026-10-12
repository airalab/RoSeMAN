# Legacy functionality deprecation

Starting on **2026-10-12**, RoSeMAN treats the Datalog/RWS pipeline and its
compatibility data model as deprecated. The code remains operational for
existing deployments, but new integrations must use CPS indexing, canonical
Connectivity storage and the V3 API.

Deprecation does not delete collections, disable routes or change response
bodies. A preserved Git tag will be created before the legacy implementation is
removed in a later change. No removal date is currently scheduled, so RoSeMAN
does not emit a `Sunset` header.

## Deprecated components

- `datalog.NewRecord` and RWS event/extrinsic handlers;
- the `datalogs`, `subscriptions` and `stories` collections and repositories;
- the Datalog JSON/IPFS measurement processor;
- the `measurements` and `cities` compatibility projection, including the CPS
  projection into those collections;
- reverse geocoding of the `cities` projection;
- `/api/sensor`, `/api/v2/sensor`, `/api/v2/story` and
  `/api/status/agents`;
- the `roseman_ipfs_queue` metric and `dedup-measurements` maintenance command.

The block indexer, CPS snapshot/realtime ingestion, `cps_anchors`, raw payloads,
canonical `connectivity_records`, V3 Connectivity API, `/api/status/last-block`
and CPS metrics remain current.

## Runtime signals

Deprecated HTTP resources return:

```http
Deprecation: @1791763200
Link: <https://github.com/airalab/RoSeMAN/blob/master/docs/legacy-deprecation.md>; rel="deprecation"
```

The `Deprecation` value is an RFC 9745 Structured Field Date representing
2026-10-12 00:00:00 UTC. Startup logs also identify active legacy handlers,
processors, APIs and projections.

## Configuration and migration

Use an explicit allowlist for every CPS-only indexer:

```dotenv
ENABLED_HANDLERS=cps-payload-set
CPS_ENABLED=true
CPS_CANONICAL_STORAGE_ENABLED=true
CPS_RAW_PAYLOAD_STORAGE_ENABLED=true
```

Legacy handler names can still be enabled explicitly during the compatibility
period, but they should not be used in new configurations. Read new data via
the `/api/v3/messages` or `/api/v3/messages/json` families instead of Sensor or
Story routes. Existing `measurements`, `cities`, `datalogs`, `subscriptions` and
`stories` collections are not migrated or removed by this deprecation step.
