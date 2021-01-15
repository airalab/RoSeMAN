import { ApiPromise, WsProvider } from "@polkadot/api";
import { u8aToString } from "@polkadot/util";
import config from "../config";

let instance = null;
let provider = null;

export function getProvider() {
  if (provider) {
    return provider;
  }
  provider = new WsProvider(config.CHAIN_API);
  provider.on("error", () => {
    console.log("err");
  });
  return provider;
}

export function getInstance() {
  if (instance) {
    return new Promise(function (resolve) {
      resolve(instance);
    });
  }
  return ApiPromise.create({
    provider: getProvider(),
    types: config.CHAIN_TYPES,
  }).then((r) => {
    instance = r;
    return r;
  });
}

export function recordToHash(r) {
  return u8aToString(r);
}
