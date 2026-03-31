import Story from "../../../models/story";
import logger from "../../../utils/logger";

export default {
  /*
   * http://127.0.0.1:3001/api/v2/story/last/4HQk933sAspxah4pP9kHmxLZNHjxrFLa1vM1VC4ESsSLyos4
   */
  async last(req, res) {
    const sensor_id = req.params.sensor_id;

    try {
      const story = await Story.findOne(
        {
          sensor_id: sensor_id,
        },
        {},
        { sort: { timestamp: -1 } }
      ).lean();

      if (story) {
        res.send({
          result: { message: story.message, timestamp: story.timestamp },
        });
      } else {
        res.send({
          error: "Not found story",
        });
      }
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
};
