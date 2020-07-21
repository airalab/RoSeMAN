import moment from "moment";
import db from "../../models/db";

const Data = db.sequelize.define("data", {
  sensor_id: {
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
  chain_sender: {
    type: db.Sequelize.STRING,
  },
  chain_result: {
    type: db.Sequelize.STRING,
  },
  chain_time: {
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
      "chain_sender",
      "model",
      "data",
      "geo",
      "chain_time",
      "timestamp",
    ],
    where: {
      chain_time: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
      model: model,
    },
    group: ["sensor_id"],
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
      "chain_sender",
      "model",
      "data",
      "geo",
      "chain_time",
      "timestamp",
    ],
    where: {
      chain_time: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
      model: model,
    },
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
      "chain_sender",
      "model",
      "data",
      "geo",
      "chain_time",
      "timestamp",
    ],
    where: {
      chain_time: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    group: ["sensor_id"],
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
    attributes: ["data", "chain_time", "timestamp"],
    where: {
      sensor_id,
      chain_time: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
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
      chain_sender: sender,
    },
    group: ["chain_time"],
  }).then((rows) => {
    return rows.length;
  });
}

export function getByDateRange(from, to) {
  return Data.findAll({
    attributes: ["data", "geo", "chain_time", "timestamp"],
    where: {
      chain_time: {
        [db.Sequelize.Op.between]: [from, to],
      },
    },
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        pm10: data.pm10,
        pm25: data.pm25,
        geo: row.geo,
        date: moment(row.timestamp, "X").format("DD.MM.YYYY HH:mm"),
      };
    });
  });
}

export function getBySensorDateRange(sensor_id, from, to) {
  return Data.findAll({
    attributes: ["data", "chain_time", "timestamp"],
    where: {
      [db.Sequelize.Op.and]: [
        db.Sequelize.where(
          db.Sequelize.fn("lower", db.Sequelize.col("sensor_id")),
          db.Sequelize.fn("lower", sensor_id)
        ),
        {
          chain_time: {
            [db.Sequelize.Op.between]: [from, to],
          },
        },
      ],
    },
    raw: true,
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        pm10: data.pm10,
        pm25: data.pm25,
        date: moment(row.timestamp, "X").format("DD.MM.YYYY HH:mm"),
      };
    });
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
    attributes: ["chain_time"],
    where: {
      chain_sender: sender,
    },
    order: [["chain_time", "DESC"]],
    raw: true,
  }).then((row) => {
    // let last = null;
    let last = 1594816986000;
    if (row !== null) {
      last = row.chain_time;
    }
    return last;
  });
}
