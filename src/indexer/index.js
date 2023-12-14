import chain from "./chain";
import ipfs from "./ipfs";

export default function (cb) {
  chain();
  ipfs(cb);
}
