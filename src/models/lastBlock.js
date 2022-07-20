import mongoose from "mongoose";

const Schema = mongoose.Schema;

const lastBlockSchema = new Schema(
  {
    block: Number,
  },
  {
    timestamps: true,
  }
);

const LastBlock = mongoose.model("lastBlock", lastBlockSchema);

export default LastBlock;
