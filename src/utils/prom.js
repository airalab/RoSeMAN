import client from "prom-client";

export default function (app) {
  const collectDefaultMetrics = client.collectDefaultMetrics;
  const Registry = client.Registry;
  const register = new Registry();
  register.setDefaultLabels({
    app: "RoSeMAN",
  });
  collectDefaultMetrics({ register });
  app.use("/metrics", (req, res) => {
    res.setHeader("Content-Type", register.contentType);
    res.end(register.metrics());
  });
}
