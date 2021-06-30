import db from "../../models/db";

const Data = db.sequelize.define("chain", {
  block: {
    type: db.Sequelize.INTEGER,
  },
  sender: {
    type: db.Sequelize.STRING,
  },
  resultHash: {
    type: db.Sequelize.STRING,
  },
  timechain: {
    type: db.Sequelize.BIGINT,
  },
  status: {
    type: db.Sequelize.INTEGER,
    default: 1,
  },
});

export default Data;

export function countTxAll() {
  return Data.count().then((rows) => {
    return rows.length;
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
