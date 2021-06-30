// import logger from "./logger";
import Model from "../modules/sensor/chain";
import Data from "../modules/sensor/table";
import { cat } from "../utils";
import config from "../config";
import logger from "./logger";
import agents from "../../agents.json";

async function getNewRows() {
  return await Model.findAll({
    attributes: ["id", "sender", "resultHash", "timechain"],
    where: { status: 1, sender: agents },
    raw: true,
  });
}

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

function mapper(json, id) {
  const list = [];
  for (const sensor_id in json) {
    const data = json[sensor_id];
    if (
      Object.prototype.hasOwnProperty.call(data, "model") &&
      Object.prototype.hasOwnProperty.call(data, "geo")
    ) {
      for (const item of data.measurements) {
        if (Object.prototype.hasOwnProperty.call(item, "timestamp")) {
          const { timestamp, ...measurement } = item;
          list.push({
            chain_id: id,
            sensor_id,
            model: data.model,
            data: JSON.stringify(measurement),
            geo: data.geo,
            timestamp: timestamp,
          });
        } else {
          // logger.info(
          //   `skip row. ${meta.chain_result} from ${meta.chain_sender}`
          // );
        }
      }
    } else {
      // logger.info(`skip msg. ${meta.chain_result} from ${meta.chain_sender}`);
    }
  }
  return list;
}

export default async function worker(cb) {
  const rows = await getNewRows();
  for (const row of rows) {
    try {
      const data = await read(row.resultHash);
      const list = mapper(data, row.id);
      await Data.bulkCreate(list);
      await Model.update({ status: 2 }, { where: { id: row.id } });

      for (const item of list) {
        cb({
          ...item,
          ...row,
        });
      }
    } catch (error) {
      logger.error(error.message);
      await Model.update({ status: 3 }, { where: { id: row.id } });
    }
  }
  setTimeout(() => {
    worker(cb);
  }, 15000);
}
