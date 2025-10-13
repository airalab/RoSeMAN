import {
  getListSensorsV2,
  getMaxValuesByDateV2,
  getMessagesByDateV2,
} from "../../../models/measurement";
import { getOwnerBySensorsV2 } from "../../../models/subscription";
import logger from "../../../utils/logger";

export default {
  async maxdata(req, res) {
    const start = req.params.start;
    const end = req.params.end;
    const type = req.params.type;

    if (end - start > 32 * 24 * 60 * 60) {
      return res.send({
        error: "Error. Max period 31 days.",
      });
    }

    try {
      const rows = await getMaxValuesByDateV2(start, end, type);
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
  async list(req, res) {
    const start = req.params.start;
    const end = req.params.end;

    if (end - start > 32 * 24 * 60 * 60) {
      return res.send({
        error: "Error. Max period 31 days.",
      });
    }

    try {
      const rows = await getListSensorsV2(start, end);
      const owners = await getOwnerBySensorsV2(
        rows.map((item) => item.sensor_id)
      );
      const result = rows.map((item) => {
        const owner = owners.find((o) => o.account === item.sensor_id);
        return {
          ...item,
          owner: owner?.owner,
        };
      });
      res.send({
        result: result,
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

    if (end - start > 32 * 24 * 60 * 60) {
      return res.send({
        error: "Error. Max period 31 days.",
      });
    }

    try {
      const rows = await getMessagesByDateV2(start, end);
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
