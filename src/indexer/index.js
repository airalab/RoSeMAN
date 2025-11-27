import config from "../config";
import LastBlock from "../models/lastBlock";
import { rosemanBlockRead } from "../utils/prometheus";
import chain, { BLOCK } from "./chain";
import { dtwin, rwsOwner, sensors } from "./chain/handlers";
import { parser as parserDTwins } from "./ipfs/dtwin";
import { parser as parserSensors } from "./ipfs/sensors";

export const CHAIN_NAME = {
  POLKADOT: "polkadot_robonomics",
  KUSAMA: "kusama_robonomics",
};

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

    // chain(
    //   config.CHAIN_API_KUSAMA,
    //   start,
    //   { extrinsic: ["datalog"], event: ["datalog/NewRecord"] },
    //   { rws: [rwsOwner, sensors], datalog: [sensors] },
    //   async (block) => {
    //     await LastBlock.updateOne({}, { block: block }).exec();
    //     rosemanBlockRead.set({ chain: "robonomics" }, block);
    //   }
    // );

    // chain(
    //   config.CHAIN_API_POLKADOT,
    //   // BLOCK.ENV,
    //   BLOCK.LAST,
    //   {
    //     extrinsic: ["rws", "digitalTwin/setSource"],
    //     event: ["digitalTwin/TopicChanged"],
    //   },
    //   { rws: [rwsOwner, dtwin], "digitalTwin/setSource": [dtwin] }
    // );

    chain(
      config.CHAIN_API_POLKADOT,
      CHAIN_NAME.POLKADOT,
      start,
      {
        extrinsic: ["datalog", "rws", "digitalTwin/setSource"],
        event: ["datalog/NewRecord", "digitalTwin/TopicChanged"],
      },
      {
        rws: [rwsOwner, sensors, dtwin],
        datalog: [sensors],
        "digitalTwin/setSource": [dtwin],
      },
      async (block) => {
        await LastBlock.updateOne(
          { chain: CHAIN_NAME.POLKADOT },
          { block: block }
        ).exec();
        rosemanBlockRead.set({ chain: "robonomics" }, block);
      }
    );
  }
  if (config.INDEX_IPFS) {
    parserSensors(cb);
    parserDTwins();
  }
}
