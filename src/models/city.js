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
  },
  {
    timestamps: true,
  }
);

const City = mongoose.model("city", citySchema);

export default City;

function getCityByPos(lat, lon, language = "ru") {
  return axios
    .get(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&accept-language=${language}`
    )
    .then((r) => {
      if (r.data.address) {
        if (r.data.address.city) {
          return r.data.address.city;
        } else if (r.data.address.town) {
          return r.data.address.town;
        } else if (r.data.address.state) {
          return r.data.address.state;
        }
      }
      return "";
    })
    .catch(() => {
      return "";
    });
}

export async function setCitySensor(sensor_id, geo, update = false) {
  const sensor = await City.findOne({ sensor_id: sensor_id });
  if (sensor) {
    if (update) {
      const pos = geo.split(",");
      const city = await getCityByPos(pos[0], pos[1]);
      await sensor.update({ geo, city: city.replace("городской округ ", "") });
      return sensor;
    }
    return;
  }
  const pos = geo.split(",");
  const city = await getCityByPos(pos[0], pos[1]);
  return await City.create({
    sensor_id,
    geo,
    city: city.replace("городской округ ", ""),
  });
}
