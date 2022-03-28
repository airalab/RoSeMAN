import mongoose from "mongoose";
import moment from "moment";

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

export async function getHistoryByDate(from, to) {
  const rows = await Data.find({
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
    result[row.sensor_id].push({
      sensor_id: row.sensor_id,
      sender: row.chain_id.sender,
      model: row.model,
      data: data,
      geo: row.geo,
      timestamp: Number(row.timestamp),
    });
  });
  return result;
}

export async function getBySensor(sensor_id) {
  const rows = await Data.find({
    sensor_id: sensor_id,
    timechain: {
      $gt: moment().subtract(1, "day").format("x"),
    },
  }).lean();
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      data: data,
      timestamp: row.timestamp,
    };
  });
}

export async function getByType(type) {
  const rows = await Data.find({
    timechain: {
      $gt: moment().subtract(1, "day").format("x"),
    },
  })
    .populate("chain_id", "sender")
    .lean();
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    if (data[type]) {
      return {
        sensor_id: row.sensor_id,
        sender: row.chain_id.sender,
        model: row.model,
        geo: row.geo,
        value: data[type],
        data: data,
        timestamp: row.timestamp,
      };
    }
    return false;
  });
}

export async function getAll() {
  const rows = await Data.find({
    model: { $or: [2, 3] },
    timechain: {
      $gt: moment().subtract(1, "day").format("x"),
    },
  })
    .populate("chain_id", "sender")
    .lean();
  return rows.map((row) => {
    const data = JSON.parse(row.data);
    return {
      sensor_id: row.sensor_id,
      sender: row.chain_id.sender,
      model: row.model,
      geo: row.geo,
      data: data,
      timestamp: row.timestamp,
    };
  });
}
