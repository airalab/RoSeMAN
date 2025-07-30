import mongoose from "mongoose";

const Schema = mongoose.Schema;

export const STATUS = {
  NEW: 1,
  READY: 2,
  ERROR: 3,
};

const digitalTwinSchema = new Schema(
  {
    block: Number,
    owner: String,
    index: Number,
    topic: String,
    source: String,
    data: {
      type: Object,
    },
    status: { type: Number, default: STATUS.NEW },
  },
  {
    timestamps: true,
  }
);

const DigitalTwin = mongoose.model("digitalTwin", digitalTwinSchema);

export default DigitalTwin;
