import moment from "moment";
import stringify from "csv-stringify";
import JSZip from "jszip";
import { getAll, getByType, getBySensor, getHistoryByDate } from "./table";
import { countTxAll, countTxBySender } from "./chain";
import logger from "../../services/logger";

export default {
  async csv(req, res) {
    const start = Number(req.params.start);
    const end = Number(req.params.end);

    try {
      const rows = await getHistoryByDate(start, end);
      const result = [];
      const headers = {
        timestamp: "timestamp",
        sensor_id: "sensor_id",
        sender: "sender",
        geo: "geo",
        pm10: "pm10",
        pm25: "pm25",
      };
      Object.keys(rows).forEach((sensor) => {
        rows[sensor].forEach((item) => {
          const row = {
            timestamp: moment(item.timestamp, "X").format("DD.MM.YYYY HH:mm"),
            sensor_id: item.sensor_id,
            sender: item.sender,
            geo: item.geo,
          };
          for (const key in item.data) {
            if (!Object.prototype.hasOwnProperty.call(headers, key)) {
              headers[key] = key;
            }
            row[key] = item.data[key];
          }
          result.push(row);
          // result.push({
          //   timestamp: moment(item.timestamp, "X").format("DD.MM.YYYY HH:mm"),
          //   sensor_id: item.sensor_id,
          //   sender: item.sender,
          //   geo: item.geo,
          //   pm10: item.data.pm10,
          //   pm25: item.data.pm25,
          //   other: JSON.stringify(item.data),
          // });
        });
      });

      stringify(
        result,
        {
          header: true,
          delimiter: ";",
          columns: headers,
          cast: {
            number: function (value) {
              return value.toString().replace(".", ",");
            },
          },
        },
        function (err, output) {
          res.setHeader("Content-Type", "application/zip");
          res.setHeader(
            "Content-disposition",
            'attachment; filename="download-' + Date.now() + '.zip"'
          );
          res.setHeader("Cache-Control", "no-cache");
          res.setHeader("Pragma", "no-cache");
          var zip = new JSZip();
          zip.file("download-" + Date.now() + ".csv", output);
          zip
            .generateNodeStream({ compression: "DEFLATE", streamFiles: true })
            .pipe(res);
        }
      );

      // res.setHeader("Content-Type", "text/csv");
      // res.setHeader(
      //   "Content-Disposition",
      //   'attachment; filename="' + "download-" + Date.now() + '.csv"'
      // );
      // res.setHeader("Cache-Control", "no-cache");
      // res.setHeader("Pragma", "no-cache");
      // stringify(result, {
      //   header: true,
      //   delimiter: ";",
      //   columns: headers,
      // }).pipe(res);
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async all(req, res) {
    try {
      const result = await getAll();

      if (result) {
        res.send({
          result,
        });
        return;
      }
      res.send({
        error: "not sensors",
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async allByType(req, res) {
    const type = req.params.type.toUpperCase();

    try {
      const result = await getByType(type);

      if (result) {
        res.send({
          result,
        });
        return;
      }
      res.send({
        error: "not sensors",
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async sensor(req, res) {
    const sensor = req.params.sensor;

    try {
      const result = await getBySensor(sensor);

      res.send({
        result,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async countTxBySender(req, res) {
    const sender = req.params.sender;

    try {
      const result = await countTxBySender(sender);

      res.send({
        result,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async countTxAll(req, res) {
    try {
      const result = await countTxAll();

      res.send({
        result,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async history(req, res) {
    const start = req.params.start;
    const end = req.params.end;

    try {
      const rows = await getHistoryByDate(start, end);
      res.send({
        result: rows,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
};
