import axios from "axios";
import logger from "../../utils/logger";

const listGateways = {
  "https://ipfs.io": 0,
  "https://gateway.ipfs.io": 0,
  "https://cloudflare-ipfs.com": 0,
  "https://cf-ipfs.com": 0,
  "https://ipfs.eth.aragon.network": 0,
  "https://ipfs-gateway.multi-agent.io": 0,
};

async function catOfGateway(hash, options) {
  logger.debug(JSON.stringify(listGateways, null, "\t"));
  const keys = Object.keys(
    Object.entries(listGateways)
      .sort(([, a], [, b]) => b - a)
      .reduce((r, [k, v]) => ({ ...r, [k]: v }), {})
  );
  for (const item of keys) {
    try {
      const res = await axios.get(`${item}/ipfs/${hash}`, options);
      listGateways[item] += 1;
      if (res.data) {
        return JSON.stringify(res.data);
      }
    } catch (error) {
      logger.warn(`${item}/ipfs/${hash} ${error.message}`);
    }
  }
  const e = new Error(`not found ${hash}`);
  e.type = "NOT_FOUND";
  throw e;
}

export async function cat(hash, options = {}) {
  return catOfGateway(hash, options);
}
