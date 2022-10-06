import Chain from "../models/chain";
import Data from "../models/data";
import { setCitySensor } from "../models/city";
import { cat } from "./tools";
import config from "../config";
import logger from "./logger";
import agents from "../../agents.json";
import pinataSDK from "@pinata/sdk";
import iconv from "iconv-lite";

const pinata = config.PINATA
  ? pinataSDK(config.PINATA.apiKey, config.PINATA.secretApiKey)
  : null;

async function getNewRows() {
  return await Chain.find({ status: 1, sender: agents }, [
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

function mapperJson(data, id, ipfs) {
  const list = [];
  if (data.model && data.geo && data.timestamp) {
    list.push({
      chain_id: id,
      sensor_id:
        data.sensor_id ||
        "d32ac7ffaea820d67822f0b9523a2e004abefda646466a92db1bbf7fcb78fa51",
      model: data.model,
      data: JSON.stringify({
        username: data.username,
        message: iconv.decode(Buffer.from(data.message), "utf8"),
        timestamp: data.timestamp,
        ipfs: ipfs,
        images: data.images || [],
        type: data.type || 0,
      }),
      geo: data.geo,
      timestamp: data.timestamp,
    });
  }
  return list;
}
function mapper(json, id) {
  const list = [];
  for (const sensor_id in json) {
    const data = json[sensor_id];
    if (data.model) {
      let geo;
      if (data.geo) {
        geo = data.geo;
      }
      for (const item of data.measurements) {
        if (item.timestamp) {
          const { timestamp, geo: geoUpdate, ...measurement } = item;
          if (geoUpdate) {
            geo = `${geoUpdate[0]},${geoUpdate[1]}`;
          }
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
              geo: geo,
              timestamp: timestamp,
            });
          }
        }
      }
    }
  }
  return list;
}

export default async function worker(cb = null) {
  const rows = await getNewRows();
  for (const row of rows) {
    try {
      logger.info(`read file ${row.resultHash}`);
      let data;
      if (row.resultHash.substring(0, 2) === "Qm") {
        if (config.MESSAGES && row.sender === config.MESSAGES.sender) {
          data = await read(`${row.resultHash}/data.json`);
        } else {
          data = await read(row.resultHash);
        }
      }
      let list = [];
      if (data.message) {
        list = mapperJson(data, row._id, row.resultHash);
      } else {
        list = mapper(data, row._id);
      }
      if (list.length > 0) {
        await Data.insertMany(list);
        for (const item of list) {
          await setCitySensor(item.sensor_id, item.geo);
        }
      }
      await Chain.updateOne(
        {
          _id: row._id,
        },
        { status: 2 }
      ).exec();

      if (pinata && row.sender === config.PINATA.sender) {
        pinata.unpin(row.resultHash).catch((err) => {
          console.log(err);
          logger.warn(`Unpin ${row.resultHash} ${err.message}`);
        });
      }

      if (cb) {
        for (const item of list) {
          try {
            cb({
              sensor_id: item.sensor_id,
              sender: row.sender,
              model: item.model,
              data: JSON.parse(item.data),
              geo: item.geo,
              timestamp: Number(item.timestamp),
            });
            // eslint-disable-next-line no-empty
          } catch (_) {}
        }
      }
    } catch (error) {
      logger.error(`parser ${error.message}`);
    }
  }
  setTimeout(() => {
    worker(cb);
  }, 15000);
}
