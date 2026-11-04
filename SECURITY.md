# Security policy

## Reporting a vulnerability

Please do **not** open a public issue for security problems.

Report them privately through GitHub:
[**Report a vulnerability**](https://github.com/airalab/RoSeMAN/security/advisories/new)
(Security tab → Advisories → Report a vulnerability).

Include the affected endpoint or module, steps to reproduce and the impact you
expect. We will acknowledge the report, keep you informed while we work on a
fix, and credit you in the advisory unless you prefer otherwise.

## Supported versions

Only the latest commit on `master`, which is what runs at
`roseman.robonomics.network`, receives security fixes.

## Scope

In scope: the REST API, the indexer and their handling of signed and encrypted
sensor payloads. Out of scope: third-party services RoSeMAN connects to
(Robonomics nodes, IPFS gateways, geocoding providers) — report those upstream.
