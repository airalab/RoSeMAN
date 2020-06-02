import moment from "moment";
import stringify from "csv-stringify";
import { getByDateRange, getBySensorDateRange } from "../models/data";

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
};
