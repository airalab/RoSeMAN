import { getInstance } from "./chain";
import LastBlock from "../modules/sensor/lastBlock";
import Model from "../modules/sensor/chain";
import logger from "./logger";

async function parseBlock(api, number) {
  const blockHash = await api.rpc.chain.getBlockHash(number);
  const allRecords = await api.query.system.events.at(blockHash);

  const success = [];
  const record = {};
  for (const event of allRecords) {
    if (
      event.event.section === "datalog" &&
      event.event.method === "NewRecord"
    ) {
      record[event.phase.asApplyExtrinsic.toNumber()] = event.event.data;
    } else if (
      event.event.section === "system" &&
      event.event.method === "ExtrinsicSuccess"
    ) {
      success.push(event.phase.asApplyExtrinsic.toNumber());
    }
  }
  const records = [];
  for (const index in record) {
    if (success.includes(Number(index))) {
      records.push(record[index]);
    }
  }
  return records;
}

async function getLastBlock() {
  const row = await LastBlock.findOne({
    attributes: ["block"],
    order: [["block", "DESC"]],
    raw: true,
  });
  if (row) {
    return row.block + 1;
  }
  await LastBlock.create({ block: 1 });
  return 1;
}

async function worker(api) {
  try {
    const lastBlock = await getLastBlock();
    const currentBlock = Number(
      (await api.rpc.chain.getBlock()).block.header.number
    );
    logger.info(`${lastBlock} ${currentBlock}`);
    for (let block = lastBlock; block < currentBlock; block++) {
      // logger.info(block);
      // const block = 18783;
      const records = await parseBlock(api, block);
      const list = [];
      for (const record of records) {
        // logger.info(record);
        list.push({
          block,
          sender: record[0].toHuman(),
          resultHash: record[2].toHuman(),
          timechain: Number(record[1].toString()),
          status: 1,
        });
      }
      await Model.bulkCreate(list);
      await LastBlock.update({ block }, { where: { id: 1 } });
    }
  } catch (error) {
    logger.error(error.message);
  }

  setTimeout(() => {
    worker(api);
  }, 15000);
}

export default async function () {
  try {
    const api = await getInstance();
    worker(api);
  } catch (error) {
    logger.error(error.message);
  }
}
