import path from "path";

export default {
  DEBUG: process.env.DEBUG
    ? process.env.DEBUG.trim().toLowerCase() === "true"
    : false,
  PORT: "3000",
  PORT_WORKER: "3001",
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
};
