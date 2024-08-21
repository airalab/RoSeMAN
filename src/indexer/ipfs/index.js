import iconv from "iconv-lite";
import agents from "../../../config/agents.json";
import config from "../../config";
import { setCitySensor } from "../../models/city";
import Chain, { STATUS } from "../../models/datalog";
import Measurement from "../../models/measurement";
import logger from "../../utils/logger";
import { cat } from "./tools";

async function getNewRows() {
  return await Chain.find({ status: STATUS.NEW, sender: agents }, [
    "id",
    "block",
    "sender",
    "resultHash",
    "timechain",
  ])
    .limit(config.PARSER_LIMIT || 50)
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
    const [lat, lng] = data.geo.split(",");
    list.push({
      datalog_id: id,
      sensor_id:
        data.sensor_id ||
        "d32ac7ffaea820d67822f0b9523a2e004abefda646466a92db1bbf7fcb78fa51",
      model: data.model,
      measurement: {
        username: data.username,
        message: iconv.decode(Buffer.from(data.message), "utf8"),
        timestamp: data.timestamp,
        ipfs: ipfs,
        images: data.images || [],
        type: data.type || 0,
      },
      geo: { lat: Number(lat), lng: Number(lng) },
      donated_by: data.donated_by || "",
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
            const [lat, lng] = geo.split(",");
            list.push({
              datalog_id: id,
              sensor_id,
              model: data.model,
              measurement: Object.keys(measurement).reduce(
                (accumulator, key) => {
                  accumulator[key.toLowerCase()] = Number(measurement[key]);
                  return accumulator;
                },
                {}
              ),
              geo: { lat: Number(lat), lng: Number(lng) },
              donated_by: data.donated_by || "",
              timestamp: timestamp,
            });
          }
        }
      }
    }
  }
  return list;
}

export default async function parser(cb = null) {
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
      } else {
        try {
          data = JSON.parse(row.resultHash);
        } catch (error) {
          logger.error(`parser ${error.message}`);
        }
      }
      let list = [];
      if (data.message) {
        list = mapperJson(data, row._id, row.resultHash);
      } else {
        list = mapper(data, row._id);
      }
      if (list.length > 0) {
        await Measurement.insertMany(list);
        for (const item of list) {
          await setCitySensor(item.sensor_id, item.geo);
        }
      }
      await Chain.updateOne(
        {
          _id: row._id,
        },
        { status: STATUS.READY }
      ).exec();

      if (cb) {
        for (const item of list) {
          try {
            cb({
              sensor_id: item.sensor_id,
              sender: row.sender,
              model: item.model,
              data: item.measurement,
              geo: item.geo,
              donated_by: item.donated_by,
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
    parser(cb);
  }, 15000);
}
