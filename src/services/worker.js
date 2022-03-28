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
      if (event.event.data[2].toHuman().substring(0, 2) === "Qm") {
        record[event.phase.asApplyExtrinsic.toNumber()] = event.event.data;
      }
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
  const row = await LastBlock.findOne({});
  if (row) {
    return row.block + 1;
  }
  await LastBlock.create({ block: 331500 });
  return 331500;
}

async function worker(api) {
  try {
    const lastBlock = await getLastBlock();
    const currentBlock = Number(
      (await api.rpc.chain.getBlock()).block.header.number
    );
    for (let block = lastBlock; block < currentBlock; block++) {
      const records = await parseBlock(api, block);
      const list = [];
      for (const record of records) {
        const isRow = await Model.findOne({
          block: block,
          sender: record[0].toHuman(),
          resultHash: record[2].toHuman(),
          timechain: Number(record[1].toString()),
        }).lean();
        if (
          isRow === null &&
          list.findIndex((item) => {
            return (
              item.block === block &&
              item.sender === record[0].toHuman() &&
              item.resultHash === record[2].toHuman() &&
              item.timechain === Number(record[1].toString())
            );
          }) < 0
        ) {
          list.push({
            block,
            sender: record[0].toHuman(),
            resultHash: record[2].toHuman(),
            timechain: Number(record[1].toString()),
            status: 1,
          });
        }
      }
      if (list.length > 0) {
        await Model.insertMany(list);
      }
      await LastBlock.updateOne({}, { block: block }).exec();
    }
  } catch (error) {
    logger.error(`worker ${api.isConnected} | ${error.message}`);
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
    logger.error(`worker init ${error.message}`);
  }
}
