import mongoose from "mongoose";
import config from "../config";

export default function () {
  return mongoose.connect(config.DB.path, {
    useUnifiedTopology: true,
    useNewUrlParser: true,
  });
}
