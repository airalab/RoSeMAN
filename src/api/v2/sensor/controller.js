import { getMaxValuesByDateV2 } from "../../../models/measurement";
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
};
