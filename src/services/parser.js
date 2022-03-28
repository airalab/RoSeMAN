import Model from "../modules/sensor/chain";
import Data from "../modules/sensor/table";
import { cat } from "../utils";
import config from "../config";
import logger from "./logger";
import agents from "../../agents.json";
import pinataSDK from "@pinata/sdk";

const pinata = pinataSDK(config.PINATA.apiKey, config.PINATA.secretApiKey);

async function getNewRows() {
  return await Model.find({ status: 1, sender: agents }, [
    "id",
    "block",
    "sender",
    "resultHash",
    "timechain",
  ])
    .limit(50)
    .sort([["createdAd", -1]])
    .lean();
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
          if (
            list.findIndex((item) => {
              return (
                item.sensor_id === sensor_id && item.timestamp === timestamp
              );
            }) < 0
          ) {
            list.push({
              chain_id: id,
              sensor_id,
              model: data.model,
              data: JSON.stringify(measurement),
              geo: data.geo,
              timestamp: timestamp,
            });
          }
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

export default async function worker(cb = null) {
  const rows = await getNewRows();
  for (const row of rows) {
    try {
      logger.info(`read file ${row.resultHash}`);
      const data = await read(row.resultHash);
      const list = mapper(data, row._id);
      if (list.length > 0) {
        await Data.insertMany(list);
      }
      await Model.updateOne(
        {
          _id: row._id,
        },
        { status: 2 }
      ).exec();

      if (row.sender === config.PINATA.sender) {
        pinata.unpin(row.resultHash).catch((err) => {
          console.log(err);
          logger.warn(`Unpin ${row.resultHash} ${err.message}`);
        });
      }

      if (cb) {
        for (const item of list) {
          cb({
            ...item,
            ...row,
          });
        }
      }
    } catch (error) {
      logger.error(`parser ${error.message}`);
      // await Model.update({ status: 3 }, { where: { id: row.id } });
    }
  }
  setTimeout(() => {
    worker(cb);
  }, 15000);
}
