# RoSeMAN

**Robonomics Sensors Measure Analytics and Archive Node** -- the indexer and analytics backend for [sensors.social](https://sensors.social). RoSeMAN watches the Robonomics parachain for sensor datalogs, fetches measurement data from IPFS, and serves it via REST API and socket.io.

## Architecture

RoSeMAN is the bridge between on-chain sensor datalogs and the user-facing sensors map. Here is the full Robonomics sensors data pipeline:

```
[1] User activates RWS subscription via Robonomics dApp

[2] Altruist (ESP32) --> signed extrinsic --> Robonomics Parachain
[3] Altruist (ESP32) --> signed msg HTTP:65 --> Sensors Connectivity Provider
[4] Connectivity validates (ED25519 + RWS subscription)
[5] Connectivity pins data to IPFS, writes hash as datalog to Parachain

[6] RoSeMAN reads chain blocks, finds datalog events     <-- starts here
[7] RoSeMAN fetches sensor data from IPFS --> MongoDB
[8] sensors.social / dApp requests historical data
[9] RoSeMAN serves measurements via REST API + socket.io
```

**RoSeMAN handles steps 6-9**: indexing chain events, fetching IPFS data, storing measurements, and serving them to frontends.

- **Steps 1-5** (device → chain): see [altruist-firmware](https://github.com/airalab/altruist-firmware) and [sensors-connectivity](https://github.com/airalab/sensors-connectivity)
- **Steps 8-9** (frontend): see [sensors.social](https://github.com/airalab/sensors.social)

## How It Works

**Indexer** connects to a Substrate-based chain (Robonomics on Kusama or Polkadot) and subscribes to new blocks. It filters extrinsics for `datalog` calls from whitelisted SS58 addresses listed in `config/agents.json`.

**IPFS fetch** takes the data hash from each datalog record and retrieves the payload from HTTP IPFS gateways. Gateways are load-balanced by success rate, with up to 10 retries per hash.

**Two data formats** are supported: sensor measurements (multi-sensor batches with PM, temperature, humidity, etc.) and messages (single geo+timestamp entries).

**Real-time updates** are pushed to connected clients via socket.io `update` event whenever new measurements are stored.

## Quick Start with Docker

Required: Docker must be installed.

```bash
mkdir config
curl -o ./config/agents.json https://raw.githubusercontent.com/airalab/RoSeMAN/master/config/agents.template.json
curl -o ./config/config.json https://raw.githubusercontent.com/airalab/RoSeMAN/master/config/config.template.json
```

Edit `config/agents.json` to whitelist the parachain addresses you want to index.

Create a `docker-compose.yml` file:

```yaml
version: "3.8"
services:
  app:
    container_name: roseman_app
    image: vol4/roseman
    ports:
      - "3000:3000"
    volumes:
      - ./config:/app/config
    depends_on:
      - mongo

  mongo:
    container_name: mongo
    image: mongo
```

```bash
docker compose up -d
```

Server runs at http://127.0.0.1:3000

## Running with Node.js

Requires MongoDB running separately.

```bash
git clone https://github.com/airalab/RoSeMAN.git
cd RoSeMAN
cp config/config.template.json config/config.json
cp config/agents.template.json config/agents.json
```

Edit `config/agents.json` to set whitelisted addresses. Edit `config/config.json` to configure MongoDB connection if needed.

```bash
yarn install
yarn build
yarn start
```

Server runs at http://127.0.0.1:3000

## Configuration

### Chain Selection

Chain is configured in [`src/indexer/index.js`](https://github.com/airalab/RoSeMAN/blob/master/src/indexer/index.js) via `chain()` calls. Each call specifies the RPC endpoint, chain name, extrinsic/event filters, and address lists.

Example for Robonomics on Polkadot:

```js
chain(
  config.CHAIN_API_POLKADOT,
  CHAIN_NAME.POLKADOT,
  start,
  {
    extrinsic: ["datalog", "rws", "digitalTwin/setSource"],
    event: ["datalog/NewRecord", "digitalTwin/TopicChanged"],
  },
  {
    rws: [rwsOwner, sensors, dtwin],
    datalog: [sensors],
    "digitalTwin/setSource": [dtwin],
  },
  async (block) => {
    await LastBlock.updateOne(
      { chain: CHAIN_NAME.POLKADOT },
      { block: block }
    ).exec();
    rosemanBlockRead.set({ chain: "robonomics" }, block);
  }
);
```

To switch chains, comment out the `chain()` call you don't need and restart the indexer.

### Agent Whitelist

`config/agents.json` contains the list of SS58 addresses whose datalogs will be indexed. Only data from these addresses is processed; everything else is ignored.

### IPFS Gateways

IPFS data is fetched via HTTP gateways (ipfs.io, gateway.ipfs.io). Gateways are selected based on success rate and each fetch is retried up to 10 times.

## API Reference

| Endpoint | Description |
|---|---|
| `GET /api/sensor/last` | Latest measurement for a sensor |
| `GET /api/sensor/history` | Historical measurements |
| `GET /api/sensor/csv` | Export measurements as CSV |
| `GET /api/v2/sensor/list` | List all known sensors |
| `socket.io "update"` | Real-time push on new measurements |

Connect this service to [sensors.social](https://sensors.social) or the [sensors map](https://github.com/airalab/sensors.robonomics.network) frontend.

## Bug Reports

https://github.com/airalab/RoSeMAN/issues

## Links

- [Robonomics Wiki](https://wiki.robonomics.network/)
- [sensors.social](https://sensors.social)
- [Sensors Map Frontend](https://github.com/airalab/sensors.robonomics.network)
