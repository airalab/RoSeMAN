import mongoose from "mongoose";

const Schema = mongoose.Schema;

const storySchema = new Schema(
  {
    block: {
      type: Number,
    },
    author: {
      type: String,
      index: true,
    },
    sensor_id: {
      type: String,
    },
    message: {
      type: String,
    },
    timestamp: {
      type: Number,
      index: true,
    },
    timechain: {
      type: Number,
    },
  },
  {
    timestamps: true,
  }
);

const Story = mongoose.model("story", storySchema);

export default Story;
