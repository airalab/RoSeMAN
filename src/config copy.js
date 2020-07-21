import path from "path";

export default {
  DEBUG: process.env.DEBUG
    ? process.env.DEBUG.trim().toLowerCase() === "true"
    : false,
  HOST: process.env.HOST || "127.0.0.1",
  PORT: process.env.PORT || "3000",
  PORT_WORKER: process.env.PORT_WORKER || "3001",
  SSL_ENABLE: process.env.SSL_ENABLE
    ? process.env.SSL_ENABLE.trim().toLowerCase() === "true"
    : false,
  SSL: {
    key: process.env.SSL_KEY || "",
    cer: process.env.SSL_CER || "",
  },
  PATH_DB: path.join(__dirname, "/../files/database.sqlite"),
  CHAIN_API: "wss://substrate.ipci.io",
  IPFS: {
    host: "localhost",
    port: "5001",
    protocol: "http",
  },
  TIMEOUT_CAT: process.env.TIMEOUT || 60000,
  START_TIME: process.env.START_TIME || 1594816986000,
  WORKER_INTERVAL: process.env.WORKER_INTERVAL || 5000,
};
