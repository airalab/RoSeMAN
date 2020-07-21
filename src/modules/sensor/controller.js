import moment from "moment";
import stringify from "csv-stringify";
import {
  getAll,
  getByType,
  getBySensor,
  getByDateRange,
  getBySensorDateRange,
  countTxBySender,
} from "./table";

export default {
  async download(req, res) {
    const sensor = req.params.agent;
    const days = req.params.days;

    const from = moment().subtract(days, "day").format("x");
    const to = moment().format("x");

    let rows = [];
    try {
      if (sensor !== "all") {
        rows = await getBySensorDateRange(sensor, from, to);
      } else {
        rows = await getByDateRange(from, to);
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="' + "download-" + Date.now() + '.csv"'
      );
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Pragma", "no-cache");
      stringify(rows, { header: true }).pipe(res);
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
};
