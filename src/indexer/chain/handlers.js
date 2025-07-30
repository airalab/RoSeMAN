import agents from "../../../config/agents.json";
import Chain, { STATUS } from "../../models/datalog";
import DigitalTwin from "../../models/digitalTwin";
import Subscription from "../../models/subscription";

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
