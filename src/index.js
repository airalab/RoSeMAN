import cors from "cors";
import express from "express";
import Socket from "socket.io";
import sensor from "./api/sensor/route";
import status from "./api/status/route";
import config from "./config";
import indexer from "./indexer";
import db from "./models/db";
import createServer from "./server";
import logger from "./utils/logger";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());
app.use("/api/sensor", sensor);
app.use("/api/status", status);

db()
  .then(() => {
    server.listen(config.SERVER.PORT, config.SERVER.HOST, () => {
      logger.info(
        "Web listening " + config.SERVER.HOST + " on port " + config.SERVER.PORT
      );
      if (!config.onlyApi) {
        indexer((item) => {
          io.emit("update", item);
        });
      } else {
        logger.warn("Indexer disabled");
      }
    });
  })
  .catch((e) => {
    logger.error(e.message);
  });
