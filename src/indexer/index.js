import config from "../config";
import LastBlock from "../models/lastBlock";
import { rosemanBlockRead } from "../utils/prometheus";
import chain, { BLOCK } from "./chain";
import { rwsOwner, sensors } from "./chain/handlers";
import ipfs from "./ipfs";

export default function (cb) {
  if (config.INDEX_CHAIN) {
    let start;
    if (process.env.START_BLOCK) {
      if (process.env.START_BLOCK === "last") {
        start = BLOCK.LAST;
      } else {
        start = BLOCK.ENV;
      }
    } else {
      start = BLOCK.DB;
    }

    chain(
      config.CHAIN_API_KUSAMA,
      start,
      { extrinsic: ["datalog"], event: ["datalog/NewRecord"] },
      { rws: [rwsOwner, sensors], datalog: [sensors] },
      async (block) => {
        await LastBlock.updateOne({}, { block: block }).exec();
        rosemanBlockRead.set({ chain: "robonomics" }, block);
      }
    );

    chain(
      config.CHAIN_API_POLKADOT,
      BLOCK.LAST,
      { extrinsic: ["rws"] },
      { rws: [rwsOwner] }
    );
  }
  if (config.INDEX_IPFS) {
    ipfs(cb);
  }
}
