import mongoose from "mongoose";

const Schema = mongoose.Schema;

const subscriptionSchema = new Schema(
  {
    account: String,
    owner: String,
  },
  {
    timestamps: true,
  }
);

const Subscription = mongoose.model("subscription", subscriptionSchema);

export default Subscription;

export async function getOwnerBySensorsV2(sensors) {
  return await Subscription.find({
    account: {
      $in: sensors,
    },
  }).lean();
}
