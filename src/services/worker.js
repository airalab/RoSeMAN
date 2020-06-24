import Data, { getLastTimeByAgent } from "../models/data";
import { getInstance, recordToHash } from "./chain";
import { parseResult } from "../utils";
import logger from "./logger";
import config from "../config";
import agents from "../../agents.json";

function save(sender, ipfshash, timechain) {
  return parseResult(ipfshash, {
    timeout: config.TIMEOUT_CAT,
  })
    .then((result) => {
      let json;
      try {
        json = JSON.parse(result);
      } catch (e) {
        logger.info(`error json ${ipfshash} from ${sender}`);
        return null;
      }

      for (const sensor_id in json) {
        const data = json[sensor_id];
        if (Object.prototype.hasOwnProperty.call(data, "model")) {
          const list = [];
          for (const item of data.measurements) {
            if (
              Object.prototype.hasOwnProperty.call(item, "geo") &&
              Object.prototype.hasOwnProperty.call(item, "timestamp")
            ) {
              const { geo, timestamp, ...measurement } = item;
              list.push({
                sensor_id,
                resultHash: ipfshash,
                sender,
                model: data.model,
                geo,
                data: JSON.stringify(measurement),
                timestamp: timestamp,
                timechain,
              });
            } else {
              logger.info(`skip row. ${ipfshash} from ${sender}`);
            }
          }
          if (list.length > 0) {
            return Data.bulkCreate(list);
          }
        } else {
          logger.info(`skip msg. ${ipfshash} from ${sender}`);
        }
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
