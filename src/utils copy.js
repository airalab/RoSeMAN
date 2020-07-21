import IPFS from "ipfs-http-client";
import config from "./config";

export const ipfs = IPFS(config.IPFS);

export async function cat(hash, options = {}) {
  const source = ipfs.cat(hash, options);
  const data = [];
  for await (const chunk of source) {
    data.push(chunk);
  }
  return Buffer.concat(data).toString();
}
