# Robonomics Sensors Measure Analytics and Archive Node (RoSeMAN)

node.js software with substrate blockchain sensors data collector function!

## Running with Docker

Required. Docker must be installed.

You need to run the following command

```bash
mkdir config
curl -o ./config/agents.json https://raw.githubusercontent.com/airalab/RoSeMAN/master/config/agents.template.json
curl -o ./config/config.json https://raw.githubusercontent.com/airalab/RoSeMAN/master/config/config.template.json
```

Make a white list of addresses, parachane accounts, from which we will collect data in the `/config/agents.json` file.

If necessary, change the configuration file `/config/config.json`.

Create a `docker-compose.yml` file with content

```
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

Run server

```bash
docker compose up -d
```

Web server launched at http://127.0.0.1:3000

As a user client, you can connect this service to [sensors map](https://github.com/airalab/sensors.robonomics.network).

## Running with Node.js

You need to clone the repository.

```bash
$ git clone https://github.com/airalab/RoSeMAN.git
```

Create configuration files.

```bash
$ cp config/config.template.json config.json
$ cp config/agents.template.json agents.json
```

!!! The work requires the Mongodb Database server.

If necessary, change access to the database in the configuration file `/config/config.json`.

Make a white list of addresses, parachane accounts, from which we will collect data in the `/config/agents.json` file.

Install requirements.

```bash
$ yarn install
```

## Building

```bash
$ yarn build
```

## Run server

```bash
$ yarn start
```

Web server launched at http://127.0.0.1:3000

## How to switch indexer between parachains / chains

RoSeMAN indexer supports indexing data from different Substrate-based chains (e.g. Robonomics parachains on Polkadot or Kusama).

Configuration is done in the file:
[`src/indexer/index.js`](https://github.com/airalab/RoSeMAN/blob/master/src/indexer/index.js)

You need to call the `chain()` function with appropriate parameters for each network you want to index.

### Example: Robonomics Parachain on Polkadot

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

### Example: Robonomics Parachain on Kusama

```js
chain(
  config.CHAIN_API_KUSAMA,
  CHAIN_NAME.KUSAMA,
  start,
  { extrinsic: ["datalog"], event: ["datalog/NewRecord"] },
  { rws: [rwsOwner, sensors], datalog: [sensors] },
  async (block) => {
    await LastBlock.updateOne(
      { chain: CHAIN_NAME.KUSAMA },
      { block: block }
    ).exec();
    rosemanBlockRead.set({ chain: "robonomics" }, block);
  }
);
```
> ***Tip***:
> Most often you need only one chain() call active. Comment out or remove the block for the chain you don't want to index at the moment.

After changing the code → restart the indexer.

As a user client, you can connect this service to [sensors map](https://github.com/airalab/sensors.robonomics.network).

## Bug Reports

See https://github.com/airalab/RoSeMAN/issues

## Learn

[Wiki](https://wiki.robonomics.network/)
