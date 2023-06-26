import mongoose from "mongoose";
import "./chain";
import City from "./city";

const Schema = mongoose.Schema;

const dataSchema = new Schema(
  {
    chain_id: {
      type: mongoose.Types.ObjectId,
      ref: "chain",
    },
    sensor_id: {
      type: String,
    },
    model: {
      type: Number,
    },
    data: {
      type: String,
    },
    geo: {
      type: String,
    },
    donated_by: {
      type: String,
    },
    lat: {
      type: Number,
    },
    lng: {
      type: Number,
    },
    timestamp: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

const Data = mongoose.model("data", dataSchema);

export default Data;

export async function getHistoryByDate(from, to, city) {
  const sensors = await City.find({ city: city });

  const rows = await Data.find({
    sensor_id: sensors.map((item) => item.sensor_id),
    timestamp: {
      $gt: from,
      $lt: to,
    },
  })
    .populate("chain_id", "sender")
    .sort({ timestamp: 1 })
    // .limit(100)
    .lean();
  const result = {};
  rows.forEach((row) => {
    const data = JSON.parse(row.data);
    if (!Object.prototype.hasOwnProperty.call(result, row.sensor_id)) {
      result[row.sensor_id] = [];
    }
    const [lat, lng] = row.geo.split(",");
    result[row.sensor_id].push({
      sensor_id: row.sensor_id,
      sender: row.chain_id.sender,
      model: row.model,
      data: data,
      geo: { lat, lng },
      timestamp: Number(row.timestamp),
    });
  });
  return result;
}
export async function getLastValuesByDate(from, to) {
  const result = {};

  const rowsStatic = await Data.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: {
          $nin: [3, 4],
        },
      },
    },
    {
      $group: {
        _id: "$sensor_id",
        sensor_id: { $first: "$sensor_id" },
        model: { $first: "$model" },
        data: { $last: "$data" },
        geo: { $first: "$geo" },
        timestamp: { $first: "$timestamp" },
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        data: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
  ]);

  const rowsMobile = await Data.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: 3,
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        data: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
    {
      $sort: {
        timestamp: 1,
      },
    },
  ]);

  const iterator = (row) => {
    if (!result[row.sensor_id]) {
      result[row.sensor_id] = [];
    }
    try {
      const [lat, lng] = row.geo.split(",");
      result[row.sensor_id].push({
        sensor_id: row.sensor_id,
        model: row.model,
        data: JSON.parse(row.data),
        geo: { lat, lng },
        donated_by: row.donated_by,
        timestamp: row.timestamp,
      });
      // eslint-disable-next-line no-empty
    } catch (_) {}
  };

  rowsStatic.forEach(iterator);
  rowsMobile.forEach(iterator);

  return result;
}
export async function getMaxValuesByDate(from, to, type) {
  const result = {};

  const rowsStatic = await Data.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: {
          $nin: [3, 4],
        },
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        data: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
  ]);

  const rowsMobile = await Data.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: 3,
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        data: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
    {
      $sort: {
        timestamp: 1,
      },
    },
  ]);

  const iterator = (row) => {
    if (!result[row.sensor_id]) {
      result[row.sensor_id] = [];
    }
    try {
      const [lat, lng] = row.geo.split(",");
      const data = JSON.parse(row.data.toLowerCase());
      if (row.model === 3) {
        result[row.sensor_id].push({
          sensor_id: row.sensor_id,
          model: row.model,
          data: data,
          geo: { lat, lng },
          donated_by: row.donated_by,
          timestamp: row.timestamp,
        });
      } else {
        if (result[row.sensor_id].length > 0) {
          if (data[type] && result[row.sensor_id][0].data[type]) {
            if (
              Number(data[type]) <= Number(result[row.sensor_id][0].data[type])
            ) {
              return;
            }
          } else if (result[row.sensor_id][0].data[type]) {
            return;
          }
        }
        result[row.sensor_id][0] = {
          sensor_id: row.sensor_id,
          model: row.model,
          data: data,
          geo: { lat, lng },
          donated_by: row.donated_by,
          timestamp: row.timestamp,
        };
      }
      // eslint-disable-next-line no-empty
    } catch (_) {}
  };

  rowsStatic.forEach(iterator);
  rowsMobile.forEach(iterator);

  return result;
}
export async function getMessagesByDate(from, to) {
  const rows = await Data.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: 4,
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        data: 1,
        geo: 1,
      },
    },
  ]);
  const result = [];
  rows.forEach((row) => {
    try {
      const [lat, lng] = row.geo.split(",");
      result.push({
        sensor_id: row.sensor_id,
        model: row.model,
        data: JSON.parse(row.data),
        geo: { lat, lng },
      });
      // eslint-disable-next-line no-empty
    } catch (_) {}
  });
  return result;
}

export async function getBySensor(sensor_id, start, end) {
  const rows = await Data.find({
    sensor_id: sensor_id,
    timestamp: {
      $gt: start,
      $lt: end,
    },
  })
    .sort({ timestamp: 1 })
    .lean();
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    const [lat, lng] = row.geo.split(",");
    return {
      data: data,
      timestamp: row.timestamp,
      geo: { lat, lng },
    };
  });
}
