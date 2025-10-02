import auth from "./auth/route";
import sensor from "./sensor/route";
import status from "./status/route";
import sensorV2 from "./v2/sensor/route";

export function api(app) {
  app.use("/api/sensor", sensor);
  app.use("/api/auth", auth);
  app.use("/api/status", status);

  app.use("/api/v2/sensor", sensorV2);
}
