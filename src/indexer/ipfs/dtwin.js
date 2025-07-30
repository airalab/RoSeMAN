import axios from "axios";
import CID from "cids";
import mh from "multihashing-async";
import config from "../../config";
import { STATUS } from "../../models/datalog";
import DigitalTwin from "../../models/digitalTwin";
import logger from "../../utils/logger";

function hexToCid(hex) {
  const digest = Buffer.from(hex.slice(2), "hex");
  const combined = mh.multihash.encode(digest, "sha2-256");
  const cid = new CID(0, "dag-pb", combined);
  return cid.toString();
}

const getFromIpfs = async (hex) => {
  const cid = hexToCid(hex);
  logger.info(`read file ${cid}`);
  const result = await axios.get(`https://ipfs.url.today/ipfs/${cid}`, {
    timeout: Number(config.TIMEOUT_CAT),
  });
  return result.headers["content-type"] === "application/json"
    ? result.data
    : undefined;
};

async function getNewDTwin() {
  return await DigitalTwin.find({ status: STATUS.NEW }, [
    "id",
    "topic",
    "source",
  ])
    .limit(config.PARSER_LIMIT || 50)
    .sort([["createdAd", -1]])
    .lean();
}

export async function parser() {
  const ZERO_ACC =
    "0x0000000000000000000000000000000000000000000000000000000000000000";
  const rows = await getNewDTwin();
  for (const row of rows) {
    try {
      logger.info(`read topic ${row.topic}`);
      if (row.source !== ZERO_ACC) {
        const res = await getFromIpfs(row.topic);
        await DigitalTwin.updateOne(
          {
            _id: row._id,
          },
          { status: STATUS.READY, data: res }
        ).exec();
      } else {
        await DigitalTwin.updateOne(
          {
            _id: row._id,
          },
          { status: STATUS.READY }
        ).exec();
      }
    } catch (error) {
      logger.error(`parser ${error.message}`);
      await DigitalTwin.updateOne(
        {
          _id: row._id,
        },
        { status: STATUS.ERROR }
      ).exec();
    }
  }
  setTimeout(() => {
    parser();
  }, 15000);
}
