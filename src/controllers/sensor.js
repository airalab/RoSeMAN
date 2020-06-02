import { getAll, getByType, getBySensor } from "../models/data";

export default {
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
};
