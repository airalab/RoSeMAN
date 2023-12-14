import mongoose from "mongoose";

const Schema = mongoose.Schema;

export const STATUS = {
  NEW: 1,
  READY: 2,
  ERROR: 3,
};

const datalogSchema = new Schema(
  {
    block: Number,
    sender: String,
    resultHash: String,
    timechain: Number,
    status: { type: Number, default: STATUS.NEW },
  },
  {
    timestamps: true,
  }
);

const Datalog = mongoose.model("datalog", datalogSchema);

export default Datalog;
