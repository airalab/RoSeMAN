import { ApiPromise, WsProvider } from "@polkadot/api";
import { u8aToString } from "@polkadot/util";
import config from "../config";

let instance = null;

export function getInstance() {
  if (instance) {
    return new Promise(function (resolve) {
      resolve(instance);
    });
  }
  const provider = new WsProvider(config.CHAIN_API);
  return ApiPromise.create({
    provider,
    types: {
      Record: "Vec<u8>",
    },
  })
    .then((r) => {
      instance = r;
      return r;
    })
    .catch((e) => {
      provider.disconnect();
      throw e;
    });
}

export function recordToHash(r) {
  return u8aToString(r);
}
