import agents from "../../../config/agents.json";
import LastBlock from "../../models/lastBlock";
import logger from "../../utils/logger";

export default {
  async lastBlock(req, res) {
    try {
      const row = await LastBlock.findOne({});
      res.send({
        result: row.block,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
  async agents(req, res) {
    try {
      res.send({
        result: agents,
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
};
