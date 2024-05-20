import axios from "axios";
import mongoose from "mongoose";

const Schema = mongoose.Schema;

const citySchema = new Schema(
  {
    sensor_id: {
      type: String,
    },
    geo: {
      lat: {
        type: Number,
      },
      lng: {
        type: Number,
      },
    },
    city: {
      type: String,
    },
    state: {
      type: String,
    },
    country: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const City = mongoose.model("city", citySchema);

export default City;

async function getCityByPos(lat, lon, language = "en") {
  if (Number(lat) > 0 && Number(lon) > 0) {
    try {
      const r = (
        await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=${language}`
        )
      ).data;
      if (r.address) {
        const city = r.name || "";
        const state =
          r.address.state ||
          r.address.county ||
          r.address.state_district ||
          r.address.region ||
          "";
        const country = r.address.country || "";
        return {
          city: city
            .replace("городской округ", "")
            .replace("сельское поселение ", "c. ")
            .replace("сельское поселение", "")
            .trim(),
          state,
          country,
        };
      }
      // eslint-disable-next-line no-empty
    } catch (_) {}
  }
  return {
    city: "",
    state: "",
    country: "",
  };
}

export async function setCitySensor(sensor_id, geo, update = false) {
  const sensor = await City.findOne({ sensor_id: sensor_id });
  if (sensor) {
    if (update) {
      const { lat, lng } = geo;
      const { city, state, country } = await getCityByPos(lat, lng);
      await sensor.updateOne({
        geo: {
          lat: Number(lat),
          lng: Number(lng),
        },
        city,
        state,
        country,
      });
      return sensor;
    }
    return;
  }
  const { lat, lng } = geo;
  const { city, state, country } = await getCityByPos(lat, lng);
  return await City.create({
    sensor_id,
    geo: {
      lat: Number(lat),
      lng: Number(lng),
    },
    city,
    state,
    country,
  });
}
