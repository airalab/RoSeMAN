import moment from "moment";
import db from "../../models/db";

const Data = db.sequelize.define("data", {
  sensor_id: {
    type: db.Sequelize.STRING,
  },
  sender: {
    type: db.Sequelize.STRING,
  },
  resultHash: {
    type: db.Sequelize.STRING,
  },
  model: {
    type: db.Sequelize.NUMBER,
  },
  data: {
    type: db.Sequelize.STRING,
  },
  geo: {
    type: db.Sequelize.STRING,
  },
  timestamp: {
    type: db.Sequelize.NUMBER,
  },
  timechain: {
    type: db.Sequelize.NUMBER,
  },
});

export default Data;

export async function getAll() {
  const model2 = await getLastRecordByModel(2);
  const model3 = await getAllByModel(3);
  return [...model2, ...model3];
}

export function getLastRecordByModel(model) {
  return Data.findAll({
    attributes: [
      [Data.sequelize.fn("max", Data.sequelize.col("id")), "id"],
      "sensor_id",
      ["sender", "chain_sender"],
      "model",
      "data",
      "geo",
      ["timechain", "chain_time"],
      "timestamp",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
      model: model,
    },
    group: ["sensor_id"],
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        sensor_id: row.sensor_id,
        sender: row.chain_sender,
        model: row.model,
        geo: row.geo,
        data: data,
        timestamp: row.timestamp,
      };
    });
  });
}

export function getAllByModel(model) {
  return Data.findAll({
    attributes: [
      "id",
      "sensor_id",
      ["sender", "chain_sender"],
      "model",
      "data",
      "geo",
      ["timechain", "chain_time"],
      "timestamp",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
      model: model,
    },
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        sensor_id: row.sensor_id,
        sender: row.chain_sender,
        model: row.model,
        geo: row.geo,
        data: data,
        timestamp: row.timestamp,
      };
    });
  });
}

export function getByType(type) {
  return Data.findAll({
    attributes: [
      [Data.sequelize.fn("max", Data.sequelize.col("id")), "id"],
      "sensor_id",
      ["sender", "chain_sender"],
      "model",
      "data",
      "geo",
      ["timechain", "chain_time"],
      "timestamp",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    group: ["sensor_id"],
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      if (data[type]) {
        return {
          sensor_id: row.sensor_id,
          sender: row.chain_sender,
          model: row.model,
          geo: row.geo,
          value: data[type],
          data: data,
          timestamp: row.timestamp,
        };
      }
      return false;
    });
  });
}

export function getBySensor(sensor_id) {
  return Data.findAll({
    attributes: ["data", ["timechain", "chain_time"], "timestamp"],
    where: {
      sensor_id,
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        data: data,
        timestamp: row.timestamp,
      };
    });
  });
}

export function countTxBySender(sender) {
  return Data.count({
    where: {
      sender: sender,
    },
    group: ["timechain"],
  }).then((rows) => {
    return rows.length;
  });
}

export function countTxAll() {
  return Data.count({
    group: ["timechain"],
  }).then((rows) => {
    return rows.length;
  });
}

export function getHistoryByDate(from, to) {
  return Data.findAll({
    attributes: ["sensor_id", "sender", "model", "data", "geo", "timestamp"],
    where: {
      timestamp: {
        [db.Sequelize.Op.between]: [from, to],
      },
    },
    order: [["timestamp", "ASC"]],
    raw: true,
  }).then((rows) => {
    const result = {};
    rows.forEach((row) => {
      const data = JSON.parse(row.data);
      if (!Object.prototype.hasOwnProperty.call(result, row.sensor_id)) {
        result[row.sensor_id] = [];
      }
      result[row.sensor_id].push({
        sensor_id: row.sensor_id,
        sender: row.sender,
        model: row.model,
        data: data,
        geo: row.geo,
        timestamp: Number(row.timestamp),
      });
    });
    return result;
  });
}

export function save(list) {
  if (list.length > 0) {
    return Data.bulkCreate(list);
  }
  return null;
}

export function getLastTimeBySender(sender) {
  return Data.findOne({
    attributes: ["timechain"],
    where: {
      sender: sender,
    },
    order: [["timechain", "DESC"]],
    raw: true,
  }).then((row) => {
    return row ? row.timechain : null;
  });
}
