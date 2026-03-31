import agents from "../../../config/agents.json";
import Chain, { STATUS } from "../../models/datalog";
import DigitalTwin from "../../models/digitalTwin";
import { MODEL } from "../../models/measurement";
import Story from "../../models/story";
import Subscription from "../../models/subscription";
import logger from "../../utils/logger";

export async function rwsOwner(extrinsic) {
  if (extrinsic.section === "rws" && extrinsic.isSuccess) {
    const result = await Subscription.findOne({
      account: extrinsic.signer,
    });
    if (result === null) {
      // console.log("create", {
      //   block: extrinsic.block,
      //   account: extrinsic.signer,
      //   owner: extrinsic.args[0].toString(),
      // });
      await Subscription.create({
        account: extrinsic.signer,
        owner: extrinsic.args[0].toString(),
      });
    } else if (result.owner !== extrinsic.args[0].toString()) {
      // console.log("update", {
      //   block: extrinsic.block,
      //   account: extrinsic.signer,
      //   owner: extrinsic.args[0].toString(),
      // });
      await result.update({ owner: extrinsic.args[0].toString() }).exec();
    } else {
      // console.log("exist", {
      //   block: extrinsic.block,
      //   account: extrinsic.signer,
      //   owner: extrinsic.args[0].toString(),
      // });
    }
  }
}

export async function sensors(extrinsic) {
  if (extrinsic.section === "rws" || extrinsic.section === "datalog") {
    for (const event of extrinsic.events) {
      if (event.section === "datalog" && event.method === "NewRecord") {
        if (agents.includes(extrinsic.signer)) {
          const record = event.data;
          const isRow = await Chain.findOne({
            block: extrinsic.block,
            sender: record[0].toHuman(),
            resultHash: record[2].toHuman(),
            timechain: Number(record[1].toString()),
          }).lean();
          if (isRow === null) {
            // console.log("new", {
            //   block: extrinsic.block,
            //   sender: record[0].toHuman(),
            //   resultHash: record[2].toHuman(),
            //   timechain: Number(record[1].toString()),
            //   status: STATUS.NEW,
            // });

            await Chain.create({
              block: extrinsic.block,
              sender: record[0].toHuman(),
              resultHash: record[2].toHuman(),
              timechain: Number(record[1].toString()),
              status: STATUS.NEW,
            });
          }
        }
      }
    }
  }
}

export async function story(extrinsic) {
  if (extrinsic.section === "rws" || extrinsic.section === "datalog") {
    const subscriptions = await Subscription.find(
      {},
      { _id: 0, owner: 1 }
    ).lean();
    const owners = [...new Set(subscriptions.map((item) => item.owner))];
    // TODO: needs to be filtered to only those that are authorized

    for (const event of extrinsic.events) {
      if (event.section === "datalog" && event.method === "NewRecord") {
        if (owners.includes(extrinsic.signer)) {
          const record = event.data;
          let data = null;
          try {
            data = JSON.parse(record[2].toHuman());
          } catch (error) {
            logger.error(`parser ${error.message}`);
          }
          if (
            data &&
            data.model &&
            data.model === MODEL.STORY &&
            data.sensor &&
            data.message &&
            data.timestamp
          ) {
            const story = {
              block: extrinsic.block,
              author: record[0].toHuman(),
              timechain: Number(record[1].toString()),
              sensor_id: data.sensor,
              message: data.message,
              timestamp: data.timestamp,
            };
            await Story.create(story);
          }
        }
      }
    }
  }
}

export async function dtwin(extrinsic) {
  if (
    (extrinsic.section === "rws" || extrinsic.section === "digitalTwin") &&
    extrinsic.isSuccess
  ) {
    for (const event of extrinsic.events) {
      if (event.section === "digitalTwin" && event.method === "TopicChanged") {
        const record = event.data;
        await DigitalTwin.create({
          block: extrinsic.block,
          owner: record[0].toHuman(),
          index: Number(record[1].toString()),
          topic: record[2].toHuman(),
          source: record[3].toHex(),
        });
      }
    }
  }
}
