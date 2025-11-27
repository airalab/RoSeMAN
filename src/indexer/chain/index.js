import LastBlock from "../../models/lastBlock";
import logger from "../../utils/logger";
import { Instance } from "./provider";
import { reader } from "./reader";

export const BLOCK = {
  LAST: 1,
  ENV: 2,
  DB: 3,
};

async function getStartBlock(start, instance) {
  let startBlock = null;
  if (start === BLOCK.LAST) {
    logger.info("Start block last chain");
    startBlock = await instance.getLastBlock();
  } else if (start === BLOCK.ENV) {
    logger.info("Start block env");
    startBlock = Number(process.env.START_BLOCK);
  } else if (start === BLOCK.DB) {
    logger.info("Start block DB");
    const row = await LastBlock.findOne({ chain: instance.chainName });
    if (row) {
      startBlock = row.block + 1;
    } else {
      logger.warn("LASTBLOCK NOT FOUND");
      startBlock = await instance.getLastBlock();
      await LastBlock.create({ block: startBlock, chain: instance.chainName });
    }
  }
  return startBlock;
}

export default async function chain(
  endpoint,
  chainName,
  start,
  filter,
  handlers,
  cb
) {
  try {
    const instance = new Instance(endpoint, chainName);
    try {
      await instance.create();
      const startBlock = await getStartBlock(start, instance);
      logger.info(`Start: ${endpoint} block ${startBlock}`);
      await reader(instance, startBlock, filter, handlers, cb);
    } catch (error) {
      logger.error(`reader ${instance.api.isConnected} | ${error.message}`);
      await instance.disconnect();
      setTimeout(() => {
        logger.info(`Restart reader: ${endpoint}`);
        chain(endpoint, start, filter, handlers, cb);
      }, 15000);
    }
  } catch (error) {
    logger.error(`reader init ${error.message}`);
  }
}
