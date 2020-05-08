import express from "express";
import net from "net";
import cors from "cors";
import Socket from "socket.io";
import createServer from "./server";
import db from "./models/db";
import sensorRouter from "./routes/sensor";
import csvRouter from "./routes/csv";
import config from "./config";
import logger from "./services/logger";

const app = express();
const server = createServer(app);
const io = Socket(server);
app.use(cors());
app.use("/api/sensor", sensorRouter);
app.use("/csv", csvRouter);

const worker = net.createServer();
worker.on("connection", (socket) => {
  socket.on("data", (msg) => {
    const item = JSON.parse(msg.toString("utf8"));
    io.emit("update", item);
  });
});

db.sequelize.sync().then(() => {
  server.listen(config.PORT, () => {
    logger.info("Web listening on port " + config.PORT);
    worker.listen(config.PORT_WORKER, () => {
      logger.info("Worker listening on port " + config.PORT_WORKER);
    });
  });
});
