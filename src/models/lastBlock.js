import mongoose from "mongoose";

const Schema = mongoose.Schema;

const lastBlockSchema = new Schema(
  {
    block: Number,
    chain: String,
  },
  {
    timestamps: true,
  }
);

const LastBlock = mongoose.model("lastBlock", lastBlockSchema);

export default LastBlock;
