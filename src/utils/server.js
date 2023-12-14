import fs from "fs";
import http from "http";
import https from "https";
import config from "../config";

export default (app) => {
  if (config.SERVER.SSL_ENABLE) {
    const options = {
      key: fs.readFileSync(config.SERVER.SSL.key),
      cert: fs.readFileSync(config.SERVER.SSL.cer),
    };
    return https.createServer(options, app);
  }
  return http.createServer(app);
};
