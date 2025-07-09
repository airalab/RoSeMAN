import logger from "../../utils/logger";

async function parseBlock(api, number, filter) {
  const result = [];
  const blockHash = await api.rpc.chain.getBlockHash(number);
  const allRecords = await api.query.system.events.at(blockHash);
  const signedBlock = await api.rpc.chain.getBlock(blockHash);
  const extrinsics = signedBlock.block.extrinsics.toArray();

  for (const index in extrinsics) {
    const extrinsic = extrinsics[index];
    const {
      isSigned,
      method: { args, method, section },
    } = extrinsic;

    if (
      !filter.extrinsic.includes(section) &&
      !filter.extrinsic.includes(`${section}/${method}`)
    ) {
      continue;
    }

    let signer;
    if (isSigned) {
      signer = extrinsic.signer.toString();
    }

    const item = {
      block: number,
      index,
      signer,
      args,
      method,
      section,
      isSuccess: false,
      events: [],
    };

    const events = [];
    const records = allRecords.filter(
      ({ phase }) => phase.isApplyExtrinsic && phase.asApplyExtrinsic.eq(index)
    );
    for (const record of records) {
      if (api.events.system.ExtrinsicSuccess.is(record.event)) {
        item.isSuccess = true;
      } else if (api.events.system.ExtrinsicFailed.is(record.event)) {
        item.isSuccess = false;
      } else {
        if (
          filter.event &&
          Array.isArray(filter.event) &&
          (filter.event.includes(record.event.section) ||
            filter.event.includes(
              `${record.event.section}/${record.event.method}`
            ))
        ) {
          events.push(record.event);
        }
      }
    }
    item.events = events;
    result.push(item);
  }
  return result;
}

async function extrinsicHandler(extrinsic, handlers) {
  for (const section in handlers) {
    if (
      section === extrinsic.section ||
      section === `${extrinsic.section}/${extrinsic.method}`
    ) {
      for (const handler of handlers[section]) {
        await handler(extrinsic);
      }
    }
  }
}

export async function reader(instance, startBlock, filter, handlers, cb) {
  const currentBlock = await instance.getLastBlock();
  logger.debug(`Blocks: ${startBlock} - ${currentBlock}`);
  for (let block = startBlock; block < currentBlock; block++) {
    logger.debug(`Block: ${block}`);
    const extrinsics = await parseBlock(instance.api, block, filter);
    for (const extrinsic of extrinsics) {
      await extrinsicHandler(extrinsic, handlers);
    }
    if (cb) {
      await cb(block);
    }
  }
  await new Promise((r) => {
    setTimeout(r, 15000);
  });
  return reader(instance, currentBlock, filter, handlers, cb);
}
