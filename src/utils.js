import IPFS from "ipfs-api";
import config from "./config";

export const ipfs = new IPFS(config.IPFS);

function ipfsCat(hash) {
  return ipfs.cat(hash);
}

export function parseResult(result) {
  return ipfsCat(result).then(function (r) {
    return r.toString("utf8");
  });
}
