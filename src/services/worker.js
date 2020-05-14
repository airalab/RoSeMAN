import Data, { getLastTimeByAgent } from "../models/data";
import { getInstance, recordToHash } from "./chain";
import { parseResult } from "../utils";
import logger from "./logger";
import config from "../config";
import agents from "../../agents.json";

function save(sender, ipfshash, timechain) {
  return parseResult(ipfshash)
    .then((result) => {
      if (result["/geo"]) {
        const list = [];
        const rows = result["/data"].sort(function (a, b) {
          if (a.timestamp > b.timestamp) {
            return 1;
          }
          if (a.timestamp < b.timestamp) {
            return -1;
          }
          return 0;
        });
        for (const row of rows) {
          if (
            Object.prototype.hasOwnProperty.call(row, "timestamp") &&
            Number(row.timestamp) > 0
          ) {
            list.push({
              sender,
              resultHash: ipfshash,
              data: JSON.stringify(row),
              geo: result["/geo"],
              timechain,
            });
          } else {
            logger.info(
              `skip row. not found timestamp. ${ipfshash} from ${sender}`
            );
          }
        }
        if (list.length > 0) {
          return Data.bulkCreate(list);
        }
      } else {
        logger.info(`skip msg. not found geo. ${ipfshash} from ${sender}`);
      }
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
      if (config.DEBUG) {
        logger.info(`start parse ipfs hash ${ipfshash} from ${agent}`);
      }
      const rows = await save(agent, ipfshash, timestamp);
      if (rows) {
        for (const row of rows) {
          cb(row);
        }
      }
    }
  }
}
