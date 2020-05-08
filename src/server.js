import fs from "fs";
import https from "https";
import http from "http";
import config from "./config";

export default (app) => {
  if (config.SSL_ENABLE) {
    const options = {
      key: fs.readFileSync(config.SSL.key),
      cert: fs.readFileSync(config.SSL.cer),
    };
    return https.createServer(options, app);
  }
  return http.createServer(app);
};
