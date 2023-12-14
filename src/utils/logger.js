import path from "path";
import winston from "winston";
import { PATH_LOGS } from "../config";

const options = {
  file: {
    level: "info",
    filename: path.join(PATH_LOGS, "/info.log"),
    handleExceptions: false,
    maxsize: 1024 * 1024 * 5, // 5MB
    maxFiles: 5
  },
  console: {
    level: "debug",
    handleExceptions: false,
    handleRejections: true,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({
        format: "YYYY-MM-DD HH:mm:ss Z"
      }),
      winston.format.printf(({ level, message, timestamp }) => {
        return `[${level}] ${timestamp}: ${message}`;
      })
    )
  },
  exception: {
    filename: path.join(PATH_LOGS, "/errors.log"),
    maxsize: 1024 * 1024 * 5, // 5MB
    maxFiles: 5
  }
};

const logger = winston.createLogger({
  transports: [
    new winston.transports.File(options.file),
    new winston.transports.Console(options.console)
  ],
  exceptionHandlers: [new winston.transports.File(options.exception)],
  format: winston.format.combine(
    winston.format.timestamp({
      format: "YYYY-MM-DD HH:mm:ss Z"
    }),
    winston.format.printf(({ level, message, timestamp }) => {
      return `[${level.toUpperCase()}] ${timestamp}: ${message}`;
    })
  ),
  exitOnError: false
});

export default logger;
