import {
  getListSensorsV2,
  getMaxValuesByDateV2,
} from "../../../models/measurement";
import { getOwnerBySensorsV2 } from "../../../models/subscription";
import logger from "../../../utils/logger";

export default {
  async maxdata(req, res) {
    const start = req.params.start;
    const end = req.params.end;
    const type = req.params.type;
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
};
