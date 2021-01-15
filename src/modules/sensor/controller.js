import moment from "moment";
import stringify from "csv-stringify";
import {
  getAll,
  getByType,
  getBySensor,
  countTxBySender,
  countTxAll,
  getHistoryByDate,
} from "./table";

export default {
  async csv(req, res) {
    const start = Number(req.params.start);
    const end = Number(req.params.end);

    try {
      const rows = await getHistoryByDate(start, end);
      const result = [];
      Object.keys(rows).forEach((sensor) => {
        rows[sensor].forEach((item) => {
          result.push({
            timestamp: moment(item.timestamp, "X").format("DD.MM.YYYY HH:mm"),
            sensor_id: item.sensor_id,
            sender: item.sender,
            geo: item.geo,
            pm10: item.data.pm10,
            pm25: item.data.pm25,
          });
        });
      });

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="' + "download-" + Date.now() + '.csv"'
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Pragma", "no-cache");
      stringify(result, { header: true, delimiter: ";" }).pipe(res);
    } catch (error) {
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
      res.send({
        error: "Error",
      });
    }
  },
};
