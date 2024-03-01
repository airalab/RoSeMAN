import agents from "../../../config/agents.json";
import Chain, { STATUS } from "../../models/datalog";
import LastBlock from "../../models/lastBlock";
import logger from "../../utils/logger";
import { rosemanBlockRead } from "../../utils/prometheus";
import { getInstance, getLastBlock } from "./provider";

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
      if (agents.includes(event.event.data[0].toString())) {
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

export async function getLastParsedBlock() {
  const row = await LastBlock.findOne({});
  if (row) {
    return row.block + 1;
  }
  const currentBlock = await getLastBlock();
  await LastBlock.create({ block: currentBlock });
  return currentBlock;
}

export async function reader(api, startBlock = null) {
  const lastBlock = startBlock || (await getLastParsedBlock());
  const currentBlock = await getLastBlock();
  for (let block = lastBlock; block < currentBlock; block++) {
    const records = await parseBlock(api, block);
    const list = [];
    for (const record of records) {
      const isRow = await Chain.findOne({
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
          status: STATUS.NEW,
        });
      }
    }
    if (list.length > 0) {
      await Chain.insertMany(list);
    }
    await LastBlock.updateOne({}, { block: block }).exec();
    rosemanBlockRead.set({ chain: "robonomics" }, block);
  }
  await new Promise((r) => {
    setTimeout(r, 15000);
  });
  return reader(api);
}

export async function init() {
  const api = await getInstance();
  let startBlock = null;
  if (process.env.START_BLOCK) {
    if (process.env.START_BLOCK === "last") {
      startBlock = await getLastBlock();
    } else {
      startBlock = Number(process.env.START_BLOCK);
    }
  } else {
    startBlock = await getLastParsedBlock();
  }
  logger.info(`Start block: ${startBlock}`);
  return { api, startBlock };
}
