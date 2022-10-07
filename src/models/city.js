import mongoose from "mongoose";
import axios from "axios";

const Schema = mongoose.Schema;

const citySchema = new Schema(
  {
    sensor_id: {
      type: String,
    },
    geo: {
      type: String,
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

async function getCityByPos(lat, lon, language = "ru") {
  if (Number(lat) > 0 && Number(lon) > 0) {
    try {
      const r = (
        await axios.get(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&accept-language=${language}`
        )
      ).data;
      if (r.address) {
        const city =
          r.address.city || r.address.village || r.address.town || "";
        const state =
          r.address.state ||
          r.address.county ||
          r.address.state_district ||
          r.address.region ||
          "";
        const country = r.address.country || "";
        return {
          city: city.replace("городской округ ", ""),
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
      const pos = geo.split(",");
      const { city, state, country } = await getCityByPos(pos[0], pos[1]);
      await sensor.updateOne({ geo, city, state, country });
      return sensor;
    }
    return;
  }
  const pos = geo.split(",");
  const { city, state, country } = await getCityByPos(pos[0], pos[1]);
  return await City.create({
    sensor_id,
    geo,
    city,
    state,
    country,
  });
}
