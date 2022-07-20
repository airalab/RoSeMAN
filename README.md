# Robonomics Sensors Measure Analytics and Archive Node (RoSeMAN)

node.js software with substrate blockchain sensors data collector function!

## Setup

  You need to clone the repository.

  ```bash
  $ git clone https://github.com/airalab/RoSeMAN.git
  ```

  Create configuration files.

  ```bash
  $ cp config.template.json config.json
  $ cp agents.template.json agents.json
  ```

  !!! The work requires the Mongodb Database server.

  If necessary, change access to the database in the configuration file `config.json`.

  Make a white list of addresses, parachane accounts, from which we will collect data in the `agents.json` file.

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

  As a user client, you can connect this service to [sensors map](https://github.com/airalab/sensors.robonomics.network).

## Bug Reports

  See https://github.com/airalab/RoSeMAN/issues

## Learn

  [Wiki](https://wiki.robonomics.network/)
