import { getAll, getByType, getBySender } from "../models/data";

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
  async sender(req, res) {
    const sender = req.params.sender;

    try {
      const result = await getBySender(sender);

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
