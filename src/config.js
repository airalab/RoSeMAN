import config from "../config.json";

export default {
  ...config,

  HOST: process.env.HOST || "127.0.0.1",
  PORT: process.env.PORT || "3000",
  SSL_ENABLE: process.env.SSL_ENABLE
    ? process.env.SSL_ENABLE.trim().toLowerCase() === "true"
    : false,
  SSL: {
    key: process.env.SSL_KEY || "",
    cer: process.env.SSL_CER || "",
  },
};
