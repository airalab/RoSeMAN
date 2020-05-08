import IPFS from "ipfs-api";
import { open } from "rosbag";
import fs from "fs";
import tmp from "tmp";
import config from "./config";

export const ipfs = new IPFS(config.IPFS);

function ipfsCat(hash) {
  return ipfs.cat(hash);
}

function rosBag(data, cb, options = {}) {
  return open(data).then((bag) => {
    return bag.readMessages(options, (result) => {
      cb(result);
    });
  });
}

export function parseResult(result, options = { topics: ["/data", "/geo"] }) {
  let message = {};
  return ipfsCat(result).then(function (r) {
    const tmpFile = tmp.fileSync();
    fs.writeFileSync(tmpFile.name, r);
    return rosBag(
      tmpFile.name,
      function (bag) {
        try {
          message[bag.topic] = JSON.parse(bag.message.data);
        } catch (error) {
          message[bag.topic] = bag.message.data;
        }
      },
      options
    ).then(function () {
      tmpFile.removeCallback();
      return message;
    });
  });
}
