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
          result: {
            author: story.author,
            message: story.message,
            timestamp: story.timestamp,
            icon: story.icon,
          },
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
  /*
   * http://127.0.0.1:3001/api/v2/story/list?limit=1&page=1
   * http://127.0.0.1:3001/api/v2/story/list?start=1774951218251&end=1774951291790
   */
  async list(req, res) {
    const start = req.query.start;
    const end = req.query.end;
    let page = Number(req.query.page) || 1;
    let limit = Number(req.query.limit) || 50;

    const filter = {};
    if ((start && !end) || (!start && end)) {
      return res.send({
        error: "Error: Invalid date range.",
      });
    } else if (start && end) {
      filter.timestamp = {
        $gt: start,
        $lt: end,
      };
    }

    if (limit > 50) {
      limit = 50;
    }

    try {
      const total = await Story.countDocuments(filter).exec();
      const totalPages = Math.ceil(total / limit);
      const skip = (page - 1) * limit;

      const stories = await Story.find(
        filter,
        {
          _id: 0,
          author: 1,
          sensor_id: 1,
          message: 1,
          icon: 1,
          timestamp: 1,
        },
        { sort: { timestamp: -1 }, skip: skip, limit: limit }
      ).lean();

      res.send({
        result: {
          totalPages,
          list: stories,
        },
      });
    } catch (error) {
      logger.error(error.toString());
      res.send({
        error: "Error",
      });
    }
  },
};
