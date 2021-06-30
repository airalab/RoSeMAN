import db from "../../models/db";

const Data = db.sequelize.define("lastBlock", {
  block: {
    type: db.Sequelize.INTEGER,
  },
});

export default Data;
