import mongoose from "mongoose";
import City from "./city";
import "./datalog";

const Schema = mongoose.Schema;

const measurementSchema = new Schema(
  {
    datalog_id: {
      type: mongoose.Types.ObjectId,
      ref: "datalog",
    },
    sensor_id: {
      type: String,
      index: true,
    },
    model: {
      type: Number,
    },
    measurement: {
      type: Object,
    },
    geo: {
      lat: {
        type: Number,
      },
      lng: {
        type: Number,
      },
    },
    donated_by: {
      type: String,
    },
    timestamp: {
      type: Number,
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

const Measurement = mongoose.model("measurement", measurementSchema);

export default Measurement;

export async function getHistoryByDate(from, to, city) {
  const sensors = await City.find({ city: city });
  const rows = await Measurement.find({
    sensor_id: sensors.map((item) => item.sensor_id),
    timestamp: {
      $gt: from,
      $lt: to,
    },
  })
    .populate("datalog_id", "sender")
    .sort({ timestamp: 1 })
    .lean();
  const result = {};
  rows.forEach((row) => {
    if (!Object.prototype.hasOwnProperty.call(result, row.sensor_id)) {
      result[row.sensor_id] = [];
    }
    result[row.sensor_id].push({
      sensor_id: row.sensor_id,
      sender: row.datalog_id ? row.datalog_id.sender : "",
      model: row.model,
      data: row.measurement,
      geo: row.geo,
      timestamp: Number(row.timestamp),
    });
  });
  return result;
}
export async function getLastValuesByDate(from, to) {
  const result = {};

  const rowsStatic = await Measurement.aggregate([
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
        measurement: { $last: "$measurement" },
        geo: { $first: "$geo" },
        timestamp: { $first: "$timestamp" },
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        measurement: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
  ]);

  const rowsMobile = await Measurement.aggregate([
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
        measurement: 1,
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
      result[row.sensor_id].push({
        sensor_id: row.sensor_id,
        model: row.model,
        data: row.measurement,
        geo: row.geo,
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

  const rowsStatic = await Measurement.aggregate([
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
        measurement: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
  ]);

  const rowsMobile = await Measurement.aggregate([
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
        measurement: 1,
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
      const measurement = row.measurement;
      if (row.model === 3) {
        result[row.sensor_id].push({
          sensor_id: row.sensor_id,
          model: row.model,
          data: measurement,
          geo: row.geo,
          donated_by: row.donated_by,
          timestamp: row.timestamp,
        });
      } else {
        if (result[row.sensor_id].length > 0) {
          if (measurement[type] && result[row.sensor_id][0].data[type]) {
            if (
              Number(measurement[type]) <=
              Number(result[row.sensor_id][0].data[type])
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
          data: measurement,
          geo: row.geo,
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
  const rows = await Measurement.aggregate([
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
        measurement: 1,
        geo: 1,
      },
    },
  ]);
  const result = [];
  rows.forEach((row) => {
    try {
      result.push({
        sensor_id: row.sensor_id,
        model: row.model,
        measurement: row.measurement,
        geo: row.geo,
      });
      // eslint-disable-next-line no-empty
    } catch (_) {}
  });
  return result;
}

export async function getBySensor(sensor_id, start, end) {
  const rows = await Measurement.find({
    sensor_id: sensor_id,
    timestamp: {
      $gt: start,
      $lt: end,
    },
  })
    .sort({ timestamp: 1 })
    .lean();
  return rows.map((row) => {
    return {
      data: row.measurement,
      timestamp: row.timestamp,
      geo: row.geo,
    };
  });
}
