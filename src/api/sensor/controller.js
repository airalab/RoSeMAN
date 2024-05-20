import { stringify } from "csv-stringify";
import JSZip from "jszip";
import moment from "moment";
import City from "../../models/city";
import {
  getBySensor,
  getHistoryByDate,
  getLastValuesByDate,
  getMaxValuesByDate,
  getMessagesByDate,
} from "../../models/measurement";
import logger from "../../utils/logger";

export default {
  async cities(req, res) {
    const start = req.params.start;
    const end = req.params.end;

    const list = {};

    try {
      const filter = [
        {
          $match: {
            city: {
              $ne: "",
            },
          },
        },
        {
          $group: {
            _id: "$city",
            country: { $first: "$country" },
            state: { $first: "$state" },
            city: { $first: "$city" },
          },
        },
        {
          $sort: {
            country: 1,
            state: 1,
            city: 1,
          },
        },
      ];

      let sensors = [];
      if (start) {
        sensors = await getLastValuesByDate(start, end);
        filter[0].$match.sensor_id = {
          $in: Object.keys(sensors),
        };
      }

      const rows = await City.aggregate(filter);
      for (const item of rows) {
        if (!list[item.country]) {
          list[item.country] = {};
        }
        if (!list[item.country][item.state]) {
          list[item.country][item.state] = [];
        }
        list[item.country][item.state].push(item.city);
      }
    } catch (error) {
      console.log(error);
    }

    res.send({
      result: list,
    });
  },
  async last(req, res) {
    const start = req.params.start;
    const end = req.params.end;

    try {
      const rows = await getLastValuesByDate(start, end);
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
  async messages(req, res) {
    const start = req.params.start;
    const end = req.params.end;

    try {
      const rows = await getMessagesByDate(start, end);
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
  async max(req, res) {
    const start = req.params.start;
    const end = req.params.end;
    const type = req.params.type;

    try {
      const rows = await getMaxValuesByDate(start, end, type);
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
  async csv(req, res) {
    const start = Number(req.params.start);
    const end = Number(req.params.end);
    const city = req.params.city;

    if (end - start > 32 * 24 * 60 * 60) {
      return res.send({
        error: "Error. Max period 31 days.",
      });
    }

    try {
      const rows = await getHistoryByDate(start, end, city);
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
            row[key] = Number(item.data[key]);
          }
          result.push(row);
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
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async sensor(req, res) {
    const sensor = req.params.sensor;
    const start = req.params.start;
    const end = req.params.end;

    try {
      const result = await getBySensor(sensor, start, end);

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
};
