# Contributing to RoSeMAN

Thanks for helping. RoSeMAN is the indexer and REST API behind
[sensors.social](https://sensors.social).

## Run it locally

You need Node.js 18+ and MongoDB (or Docker).

```bash
npm install
cp .env.example .env                    # API + modules
cp .env.polkadot.example .env.polkadot  # Polkadot indexer
npm run start:dev
```

Or start everything, MongoDB included, with `docker compose up -d --build`.
Configuration is described in the [README](README.md#configuration) and
[docs/](docs/README.md).

## Before you open a pull request

```bash
npm run build
npm test
npm run lint      # note: runs eslint --fix and rewrites files
```

- Keep a pull request to one topic; unrelated reformatting makes review harder.
- New code goes into the CPS indexer and the V3 Connectivity API. Datalog/RWS,
  the `measurements`/`cities` projection and the Sensor/Story APIs are
  [deprecated](docs/legacy-deprecation.md) and accept fixes only.
- Update `docs/` when you change an endpoint, an environment variable or a schema.

## Workflow

1. Fork the repository, or create a branch if you have write access.
2. Open a pull request against `master` and describe what changed and how you
   tested it.
3. A maintainer reviews and merges. Please do not merge your own pull request.

Bugs and feature requests go to [Issues](https://github.com/airalab/RoSeMAN/issues).
Security problems do not — see [SECURITY.md](SECURITY.md).

## Licence of contributions

RoSeMAN is licensed under [AGPL-3.0-only](LICENSE) (see [NOTICE](NOTICE)).
By submitting a contribution you agree that it is licensed under the same terms.
