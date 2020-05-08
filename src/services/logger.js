import winston from "winston";
import path from "path";

const options = {
  file: {
    level: "info",
    filename: path.join(__dirname, "/../../files/logs/info.log"),
    handleExceptions: false,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.printf(({ level, message, timestamp }) => {
        return `[${level.toUpperCase()}] ${timestamp}: ${message}`;
      })
    ),
    maxsize: 1024 * 1024 * 5, // 5MB
    maxFiles: 5,
  },
  console: {
    level: "debug",
    handleExceptions: true,
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp(),
      winston.format.printf(({ level, message, timestamp }) => {
        return `[${level}] ${timestamp}: ${message}`;
      })
    ),
  },
  exception: {
    name: "Error Logs",
    filename: path.join(__dirname, "/../../files/logs/errors.log"),
    zippedArchive: true,
    maxsize: 1024 * 1024 * 5, // 5MB
    maxFiles: 5,
  },
};

const logger = winston.createLogger({
  transports: [
    new winston.transports.File(options.file),
    new winston.transports.Console(options.console),
  ],
  exceptionHandlers: [new winston.transports.File(options.exception)],
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp, ...meta }) => {
      return `[${level.toUpperCase()}] ${timestamp}: ${message} \n${JSON.stringify(
        meta
      )}`;
    })
  ),
  exitOnError: false,
});

process.on("unhandledRejection", (ex) => {
  throw ex;
});

export default logger;
