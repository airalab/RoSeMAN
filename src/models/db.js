import path from "path";
import Sequelize from "sequelize";
import config from "../config";
import logger from "../services/logger";

let sequelize;
if (config.DB.dialect === "sqlite") {
  sequelize = new Sequelize({
    dialect: "sqlite",
    storage: path.join(__dirname, "/../../", config.DB.path),
    logging: config.DEBUG ? (msg) => logger.debug(msg) : false,
  });
} else if (config.DB.dialect === "mysql") {
  sequelize = new Sequelize(
    config.DB.name,
    config.DB.user,
    config.DB.password,
    {
      dialect: "mysql",
      host: config.DB.host,
      logging: config.DEBUG ? (msg) => logger.debug(msg) : false,
    }
  );
} else {
  throw new Error("Not found db dialect");
}

const db = {};
db.Sequelize = Sequelize;
db.sequelize = sequelize;
db.model = {};

export default db;
