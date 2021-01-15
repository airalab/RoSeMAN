import { createTypeUnsafe } from "@polkadot/types";
import { u8aToU8a, compactFromU8a } from "@polkadot/util";
import { storageFromMeta } from "@polkadot/metadata";
import { getInstance, getProvider, recordToHash } from "./chain";
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

async function eachDatalog(agent, datalog, cb) {
  for (const item of datalog) {
    const ipfshash = recordToHash(item[1]);
    const timestamp = Number(item[0].toString());
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

function parseDataHex(api, value, skip) {
  const input = u8aToU8a(value);
  const [offset, length] = compactFromU8a(input);
  const data = input.subarray(offset);
  const result = [];
  const countChanks = Number(length) - skip.count;
  let cursor = 0 + skip.pos;
  let chank = 1;
  for (chank; chank <= countChanks; chank++) {
    const timeEnd = cursor + 8;
    const [, dataLength] = compactFromU8a(data.subarray(timeEnd));
    const dataEnd = Number(dataLength) + 1;
    const timeBytes = data.subarray(cursor, timeEnd);
    const timeType = createTypeUnsafe(
      api.registry,
      "MomentOf",
      [timeBytes],
      true
    );
    if (
      !Object.prototype.hasOwnProperty.call(skip, "time") ||
      skip.time === 0 ||
      Number(timeType.toString()) > skip.time
    ) {
      const dataBytes = data.subarray(timeEnd, timeEnd + dataEnd);
      const dataType = createTypeUnsafe(
        api.registry,
        "Vec<u8>",
        [dataBytes],
        true
      );
      result.push([timeType, dataType]);
    }
    cursor = timeEnd + dataEnd;
  }
  return [
    chank === 1 ? skip : { count: chank + skip.count - 1, pos: cursor },
    result,
  ];
}

export default async function worker(cb) {
  const api = await getInstance();
  const provider = getProvider();

  const metadata = await api.rpc.state.getMetadata();
  const fnMeta = storageFromMeta(api.registry, metadata);

  const work = {};
  for (const agent of agents) {
    let lastTime = Number(await module.model.getLastTimeBySender(agent));
    if (lastTime === 0 && config.START_TIME > 0) {
      lastTime = Number(config.START_TIME);
    }
    const limitTime = Number(moment().subtract(7, "days").format("x"));
    if (lastTime < limitTime) {
      lastTime = limitTime;
    }

    work[agent] = {
      status: false,
      skip: { count: 0, pos: 0, time: lastTime },
    };

    const paramsType = createTypeUnsafe(
      api.registry,
      "StorageKey",
      [[fnMeta.datalog.datalog, agent]],
      true
    );
    provider.subscribe(
      "state_storage",
      "state_subscribeStorage",
      [[paramsType.toHex()]],
      (_, r) => {
        if (!work[agent].status) {
          work[agent].status = true;
          const res = parseDataHex(api, r.changes[0][1], work[agent].skip);
          work[agent].skip = res[0];
          // console.log("last", work[agent].skip.count, work[agent].skip.pos);
          eachDatalog(agent, res[1], cb).then(() => {
            work[agent].status = false;
          });
        }
      }
    );
  }
}
