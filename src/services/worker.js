import { getInstance, recordToHash } from "./chain";
import moment from "moment";
import { cat } from "../utils";
import logger from "./logger";
import config from "../config";
import agents from "../../agents.json";

const module = require(`../modules/${config.WORKER_MODULE}`);

function read(ipfshash) {
  return cat(ipfshash, {
    timeout: Number(config.TIMEOUT_CAT),
  })
    .then((result) => {
      try {
        return JSON.parse(result);
      } catch (_) {
        const e = new Error(`error json ${ipfshash}`);
        e.type = "JSON_PARSE";
        throw e;
      }
    })
    .catch((e) => {
      if (e.type === "JSON_PARSE") {
        throw e;
      } else {
        const e = new Error(`not found ${ipfshash}`);
        e.type = "NOT_FOUND";
        throw e;
      }
    });
}

export default async function worker(cb) {
  const api = await getInstance();
  for (const agent of agents) {
    let lastTime = Number(await module.model.getLastTimeBySender(agent));
    if (lastTime === 0 && config.START_TIME > 0) {
      lastTime = Number(config.START_TIME);
    }
    const limitTime = Number(moment().subtract(1, "month").format("x"));
    if (lastTime < limitTime) {
      lastTime = limitTime;
    }

    let datalog = await api.query.datalog.datalog(agent);

    if (lastTime > 0) {
      datalog = datalog.filter((item) => {
        return Number(item[0]) > lastTime;
      });
    }

    for (const item of datalog) {
      const ipfshash = recordToHash(item[1]);
      const timestamp = Number(item[0]);
      if (config.DEBUG) {
        logger.info(`start parse ipfs hash ${ipfshash} from ${agent}`);
      }
      try {
        const data = await read(ipfshash);
        const list = module.mapper(data, {
          chain_sender: agent,
          chain_result: ipfshash,
          chain_time: timestamp,
        });
        const rows = await module.model.save(list);
        if (rows) {
          for (const row of rows) {
            cb(row);
          }
        }
      } catch (error) {
        logger.error(`${error.message} from ${agent}`);
      }
    }
  }
}
