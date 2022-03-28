import IPFS from "ipfs-http-client";
import axios from "axios";
import logger from "./services/logger";
import config from "./config";

let ipfs;
if (config.IPFS) {
  ipfs = IPFS(config.IPFS);
}

async function catGateway(hash, options) {
  const res = await axios.get(`${config.IPFS_GATEWAY}/ipfs/${hash}`, options);
  return JSON.stringify(res.data);
}

async function catNode(hash, options = {}) {
  const source = ipfs.cat(hash, options);
  const data = [];
  for await (const chunk of source) {
    data.push(chunk);
  }
  return Buffer.concat(data).toString();
}

export async function cat(hash, options = {}) {
  if (ipfs) {
    try {
      return await catNode(hash, options);
    } catch (error) {
      logger.error(`hash: ${hash} | ${error.message}`);
    }
  }
  return catGateway(hash, options);
}
