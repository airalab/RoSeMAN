import Data, { getLastTimeByAgent } from "../models/data";
import { getInstance, recordToHash } from "./chain";
import { parseResult } from "../utils";
import logger from "./logger";
import agents from "../../agents.json";

function save(sender, ipfshash, timechain) {
  return parseResult(ipfshash)
    .then((result) => {
      if (result["/geo"] === "") {
        result["/geo"] = "59.9646,30.4033";
      }
      if (result["/geo"]) {
        return Data.create({
          sender,
          resultHash: ipfshash,
          data: JSON.stringify(result["/data"]),
          geo: result["/geo"],
          timechain,
        });
      }
      logger.info(`skip ${ipfshash} from ${sender}`);
      return null;
    })
    .catch(() => {
      logger.info(`error ${ipfshash} from ${sender}`);
      return null;
    });
}

export default async function worker(cb) {
  const api = await getInstance();
  for (const agent of agents) {
    const lastTime = await getLastTimeByAgent(agent);

    let list = await api.query.datalog.datalog(agent);
    if (lastTime) {
      list = list.filter((item) => {
        return Number(item[0]) > lastTime;
      });
    }

    for (const item of list) {
      const ipfshash = recordToHash(item[1]);
      const timestamp = Number(item[0]);
      const row = await save(agent, ipfshash, timestamp);
      if (row) {
        cb(row);
      }
    }
  }
}
