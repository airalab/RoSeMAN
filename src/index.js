import express from "express";
import cors from "cors";
import Socket from "socket.io";
import createServer from "./server";
import db from "./models/db";
import sensor from "./modules/sensor/route";
import config from "./config";
import logger from "./services/logger";
import prom from "./services/prom";
import worker from "./services/worker";
import parser from "./services/parser";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());

app.use("/api/sensor", sensor);

prom(app);

db.sequelize.sync().then(() => {
  server.listen(config.PORT, config.HOST, () => {
    logger.info("Web listening " + config.HOST + " on port " + config.PORT);

    worker();
    parser((item) => {
      io.emit("update", item);
    });
  });
});
