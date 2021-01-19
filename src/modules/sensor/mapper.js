import logger from "../../services/logger";

export default function (json, meta) {
  const list = [];
  for (const sensor_id in json) {
    const data = json[sensor_id];
    if (
      Object.prototype.hasOwnProperty.call(data, "model") &&
      Object.prototype.hasOwnProperty.call(data, "geo")
    ) {
      for (const item of data.measurements) {
        if (Object.prototype.hasOwnProperty.call(item, "timestamp")) {
          const { timestamp, ...measurement } = item;
          list.push({
            sensor_id,
            model: data.model,
            geo: data.geo,
            data: JSON.stringify(measurement),
            timestamp: timestamp,
            sender: meta.chain_sender,
            resultHash: meta.chain_result,
            timechain: meta.chain_time,
          });
        } else {
          logger.info(
            `skip row. ${meta.chain_result} from ${meta.chain_sender}`
          );
        }
      }
    } else {
      logger.info(`skip msg. ${meta.chain_result} from ${meta.chain_sender}`);
    }
  }
  return list;
}
