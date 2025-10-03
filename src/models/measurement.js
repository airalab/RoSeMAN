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

const MODEL = {
  STATIC: 2,
  MOVE: 3,
  MESSAGE: 4,
};

export async function getHistoryByDate(from, to, city, bound) {
  const filter = {
    timestamp: {
      $gt: from,
      $lt: to,
    },
  };
  if (bound) {
    filter["geo.lat"] = {
      $lte: bound.northEast.lat,
      $gte: bound.southWest.lat,
    };
    filter["geo.lng"] = {
      $lte: bound.northEast.lng,
      $gte: bound.southWest.lng,
    };
  }
  if (city) {
    const sensors = await City.find({ city: city });
    filter.sensor_id = sensors.map((item) => item.sensor_id);
  }
  const rows = await Measurement.find(filter)
    .populate("datalog_id", "sender")
    .sort({ timestamp: 1 })
    .lean();
  const result = {};
  rows.forEach((row) => {
    if (!Object.prototype.hasOwnProperty.call(result, row.sensor_id)) {
      result[row.sensor_id] = [];
    }
    result[row.sensor_id].push({
      sender: row.datalog_id ? row.datalog_id.sender : "",
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
export async function getLastValueTypeByDate(from, to, type) {
  const result = {};

  const rows = await Measurement.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        [`measurement.${type}`]: { $exists: true },
      },
    },
    {
      $group: {
        _id: "$sensor_id",
        value: { $last: `$measurement.${type}` },
      },
    },
  ]);
  const rowsAll = await Measurement.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
      },
    },
    {
      $group: {
        _id: "$sensor_id",
        model: { $first: "$model" },
        geo: { $first: "$geo" },
      },
    },
  ]);

  for (const item of rowsAll) {
    const value = rows.find((row) => row._id === item._id);
    result[item._id] = [
      {
        ...item,
        sensor_id: item._id,
        data: value ? { [type]: value.value } : {},
      },
    ];
  }

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
export async function getMaxValuesByDateV2(from, to, type) {
  const rows = await Measurement.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(from),
          $lt: Number(to),
        },
        model: MODEL.STATIC,
      },
    },
    {
      $group: {
        _id: "$sensor_id",
        sensor_id: { $first: "$sensor_id" },
        model: { $first: "$model" },
        value: { $max: "$measurement." + type },
        geo: { $first: "$geo" },
        timestamp: { $first: "$timestamp" },
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        value: 1,
        geo: 1,
        timestamp: 1,
      },
    },
  ]);

  const result = {};
  for (const row of rows) {
    result[row.sensor_id] = {
      model: row.model,
      geo: row.geo,
      timestamp: row.timestamp,
      value: row.value,
    };
  }

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

export async function getMeasurements(start, end) {
  const rows = await Measurement.find(
    {
      timestamp: {
        $gt: start,
        $lt: end,
      },
    },
    { measurement: 1 }
  ).lean();
  let res = [];
  for (const item of rows) {
    if (item.measurement) {
      res = [...new Set([...res, ...Object.keys(item.measurement)])];
    }
  }
  return res;
}
export async function getListSensorsV2(start, end) {
  const rows = await Measurement.aggregate([
    {
      $match: {
        timestamp: {
          $gt: Number(start),
          $lt: Number(end),
        },
      },
    },
    {
      $group: {
        _id: "$sensor_id",
        sensor_id: { $first: "$sensor_id" },
        model: { $first: "$model" },
        geo: { $first: "$geo" },
        donated_by: { $first: "$donated_by" },
        timestamp: { $first: "$timestamp" },
      },
    },
    {
      $project: {
        _id: 0,
        sensor_id: 1,
        model: 1,
        geo: 1,
        donated_by: 1,
        timestamp: 1,
      },
    },
  ]);
  return rows;
}
