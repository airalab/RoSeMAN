import moment from "moment";
import db from "./db";

const Data = db.sequelize.define("data", {
  sender: {
    type: db.Sequelize.STRING,
  },
  resultHash: {
    type: db.Sequelize.STRING,
  },
  data: {
    type: db.Sequelize.STRING,
  },
  geo: {
    type: db.Sequelize.STRING,
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
      "sender",
      "data",
      "geo",
      "timechain",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    group: ["sender"],
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      return {
        sender: row.sender,
        geo: row.geo,
        data: data,
        timestamp: row.timechain,
      };
    });
  });
}

export function getByType(type) {
  return Data.findAll({
    attributes: [
      [Data.sequelize.fn("max", Data.sequelize.col("id")), "id"],
      "sender",
      "data",
      "geo",
      "timechain",
    ],
    where: {
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
    group: ["sender"],
  }).then((rows) => {
    return rows.map((row) => {
      const data = JSON.parse(row.data);
      if (data[type]) {
        return {
          sender: row.sender,
          geo: row.geo,
          value: data[type],
          data: data,
          timestamp: row.timechain,
        };
      }
      return false;
    });
  });
}

export function getBySender(sender) {
  return Data.findAll({
    attributes: ["data", "timechain"],
    where: {
      sender,
      timechain: {
        [db.Sequelize.Op.gte]: moment().subtract(1, "day").format("x"),
      },
    },
  }).then((rows) => {
    return rows.map((row) => {
      return {
        data: JSON.parse(row.data),
        timestamp: row.timechain,
      };
    });
  });
}

export function getByDateRange(from, to) {
  return Data.findAll({
    attributes: ["data", "geo", "timechain"],
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
        pm10: data.PM10,
        pm25: data["PM2.5"],
        geo: row.geo,
        date: moment(new Date(row.timechain)).format("DD.MM.YYYY HH:mm"),
      };
    });
  });
}

export function getBySenderDateRange(sender, from, to) {
  return Data.findAll({
    attributes: ["data", "timechain"],
    where: {
      [db.Sequelize.Op.and]: [
        db.Sequelize.where(
          db.Sequelize.fn("lower", db.Sequelize.col("sender")),
          db.Sequelize.fn("lower", sender)
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
        pm10: data.PM10,
        pm25: data["PM2.5"],
        date: moment(new Date(row.timechain)).format("DD.MM.YYYY HH:mm"),
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
