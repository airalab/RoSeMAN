import moment from "moment";
import db from "./db";

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

export function getAll() {
  return Data.findAll({
    attributes: [
      [Data.sequelize.fn("max", Data.sequelize.col("id")), "id"],
      "sensor_id",
      "sender",
      "data",
      "geo",
      "timechain",
      "timestamp",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    group: ["sensor_id"],
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        sensor_id: row.sensor_id,
        sender: row.sender,
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
      "sender",
      "data",
      "geo",
      "timechain",
      "timestamp",
    ],
    where: {
      timechain: {
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
          sender: row.sender,
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
    attributes: ["data", "timechain", "timestamp"],
    where: {
      sensor_id,
      timechain: {
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

export function getByDateRange(from, to) {
  return Data.findAll({
    attributes: ["data", "geo", "timechain", "timestamp"],
    where: {
      timechain: {
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
    attributes: ["data", "timechain", "timestamp"],
    where: {
      [db.Sequelize.Op.and]: [
        db.Sequelize.where(
          db.Sequelize.fn("lower", db.Sequelize.col("sensor_id")),
          db.Sequelize.fn("lower", sensor_id)
        ),
        {
          timechain: {
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

export function getLastTimeByAgent(sender) {
  return Data.findOne({
    attributes: ["timechain"],
    where: {
      sender,
    },
    order: [["timechain", "DESC"]],
    raw: true,
  }).then((row) => {
    let last = null;
    if (row !== null) {
      last = row.timechain;
    }
    return last;
  });
}
