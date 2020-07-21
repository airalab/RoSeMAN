import express from "express";
import cors from "cors";
import Socket from "socket.io";
import createServer from "./server";
import db from "./models/db";
import raas from "./modules/raas/route";
import sensor from "./modules/sensor/route";
import config from "./config";
import logger from "./services/logger";
import worker from "./services/worker";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());

app.use("/api/raas", raas);
app.use("/api/sensor", sensor);

let work = false;
setInterval(() => {
  if (!work) {
    work = true;
    worker((item) => {
      io.emit("update", item);
    })
      .then(() => {
        work = false;
      })
      .catch((e) => {
        logger.error(e.message);
        work = false;
      });
  }
}, config.WORKER_INTERVAL);

db.sequelize.sync().then(() => {
  server.listen(config.PORT, config.HOST, () => {
    logger.info("Web listening " + config.HOST + " on port " + config.PORT);
  });
});
