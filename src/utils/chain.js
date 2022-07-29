import { ApiPromise, WsProvider } from "@polkadot/api";
import { u8aToString } from "@polkadot/util";
import logger from "./logger";
import config from "../config";

let api = null;
let provider = null;

export function getProvider() {
  if (provider) {
    return provider;
  }
  provider = new WsProvider(config.CHAIN_API);
  provider.on("connected", () => {
    logger.info("Connected provider");
  });
  provider.on("disconnected", () => {
    logger.warn("Disconnected provider");
  });
  provider.on("error", (e) => {
    logger.error(`Error provider ${e.message}`);
  });
  return provider;
}

export function getInstance() {
  if (api) {
    return new Promise(function (resolve) {
      resolve(api);
    });
  }
  return ApiPromise.create({
    provider: getProvider(),
    types: config.CHAIN_TYPES,
  }).then((r) => {
    api = r;
    return r;
  });
}

export async function disconnect() {
  await api.disconnect();
  await provider.disconnect();
  api = null;
  provider = null;
}

export function recordToHash(r) {
  return u8aToString(r);
}
