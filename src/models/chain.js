import mongoose from "mongoose";

const Schema = mongoose.Schema;

const chainSchema = new Schema(
  {
    block: Number,
    sender: String,
    resultHash: String,
    timechain: Number,
    status: { type: Number, default: 1 },
  },
  {
    timestamps: true,
  }
);

const Chain = mongoose.model("chain", chainSchema);

export default Chain;
