import express from "express";
import cors from "cors";
import Socket from "socket.io";
import createServer from "./server";
import sensor from "./api/route";
import config from "./config";
import logger from "./utils/logger";
import prom from "./utils/prom";
import worker from "./utils/worker";
import parser from "./utils/parser";
import db from "./models/db";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());

app.use("/api/sensor", sensor);

prom(app);

db().then(() => {
  server.listen(config.SERVER.PORT, config.SERVER.HOST, () => {
    logger.info(
      "Web listening " + config.SERVER.HOST + " on port " + config.SERVER.PORT
    );

    worker();
    parser((item) => {
      io.emit("update", item);
    });
  });
});
