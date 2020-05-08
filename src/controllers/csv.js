import moment from "moment";
import stringify from "csv-stringify";
import { getByDateRange, getBySenderDateRange } from "../models/data";

export default {
  async download(req, res) {
    const sender = req.params.agent;
    const days = req.params.days;

    const from = moment().subtract(days, "day").format("x");
    const to = moment().format("x");

    let rows = [];
    try {
      if (sender !== "all") {
        rows = await getBySenderDateRange(sender, from, to);
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
