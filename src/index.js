import cors from "cors";
import express from "express";
import Socket from "socket.io";
import auth from "./api/auth/route";
import sensor from "./api/sensor/route";
import status from "./api/status/route";
import config from "./config";
import indexer from "./indexer";
import db from "./models/db";
import createServer from "./server";
import logger from "./utils/logger";
import { metrics, update } from "./utils/prometheus";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());
app.use(express.json());
app.use(express.urlencoded());
app.use("/api/sensor", sensor);
app.use("/api/auth", auth);
app.use("/api/status", status);
app.get("/metrics", metrics);

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
      update();
    });
  })
  .catch((e) => {
    logger.error(e.message);
  });
