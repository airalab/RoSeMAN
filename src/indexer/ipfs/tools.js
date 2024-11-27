import axios from "axios";
import config from "../../config";
import logger from "../../utils/logger";

const listGateways = (config.listOfGateways || ["https://ipfs.io"]).reduce(
  (gateways, curr) => {
    if (typeof curr === "string") {
      gateways[`${curr}/ipfs/`] = {
        url: `${curr}/ipfs/`,
        method: "get",
        options: {},
      };
    } else if (curr.url) {
      gateways[curr.url] = curr;
    }
    return gateways;
  },
  {}
);
const counterGateways = Object.entries(listGateways).reduce(
  (result, curr) => ((result[curr[0]] = 0), result),
  {}
);

async function catOfGateway(hash, options) {
  logger.debug(JSON.stringify(counterGateways, null, "\t"));
  const sortedGateways = Object.keys(
    Object.entries(counterGateways)
      .sort(([, a], [, b]) => b - a)
      .reduce((r, [k, v]) => ({ ...r, [k]: v }), {})
  );
  for (const item of sortedGateways) {
    try {
      const gateway = listGateways[item];
      let res;
      if (gateway.method === "post") {
        res = await axios.post(
          `${item}${hash}`,
          {},
          {
            ...options,
            ...gateway.options,
          }
        );
      } else {
        res = await axios.get(`${item}${hash}`, {
          ...options,
          ...gateway.options,
        });
      }
      counterGateways[item] += 1;
      if (res.data) {
        return JSON.stringify(res.data);
      }
    } catch (error) {
      logger.warn(`${item}${hash} ${error.message}`);
    }
  }
  const e = new Error(`not found ${hash}`);
  e.type = "NOT_FOUND";
  throw e;
}

export async function cat(hash, options = {}) {
  return catOfGateway(hash, options);
}
