import db from "../../models/db";

const Model = db.sequelize.define("raas", {
  action: {
    type: db.Sequelize.STRING,
  },
  data: {
    type: db.Sequelize.STRING,
  },
  success: {
    type: db.Sequelize.BOOLEAN,
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

export default Model;

export function getLastTimeBySender(sender) {
  return Model.findOne({
    attributes: ["chain_time"],
    where: {
      chain_sender: sender,
    },
    order: [["chain_time", "DESC"]],
    raw: true,
  }).then((row) => {
    return row ? row.chain_time : null;
  });
}

export function save(list) {
  if (list.length > 0) {
    return Model.bulkCreate(list);
  }
  return null;
}

export function getCountSuccess() {
  return Model.count({ where: { success: true } });
}

export function getCountError() {
  return Model.count({ where: { success: false } });
}

export function getLastSuccess() {
  return Model.findAll({
    where: { success: true },
    order: [["chain_time", "DESC"]],
    limit: 10,
    raw: true,
  });
}

export function getCountTxSuccess() {
  return Model.count({
    where: { success: true },
    group: ["chain_result"],
  }).then((result) => {
    return result.length;
  });
}

export function getLastTxTime() {
  return Model.findOne({
    attributes: ["chain_time"],
    where: { success: true },
    order: [["chain_time", "DESC"]],
  }).then((result) => {
    return result.chain_time;
  });
}
