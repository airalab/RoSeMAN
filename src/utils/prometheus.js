import Prometheus from "prom-client";
import Datalog from "../models/datalog";

const register = new Prometheus.Registry();

export const rosemanBlockRead = new Prometheus.Gauge({
  name: "roseman_block_read",
  help: "roseman_block_read Number of the last block read",
  registers: [register],
  labelNames: ["chain"],
});

export const rosemanIpfsQueue = new Prometheus.Gauge({
  name: "roseman_ipfs_queue",
  help: "roseman_ipfs_queue Number of unprocessed ipfs hashes in queue",
  registers: [register],
});

// rosemanBlockRead.set({ chain: "robonomics" }, 4232344);
// rosemanIpfsQueue.set({}, 5);

export async function update() {
  const count = await Datalog.count({ status: 1 });
  rosemanIpfsQueue.set({}, count);

  setTimeout(() => {
    update();
  }, 5000);
}

export function metrics(req, res) {
  res.setHeader("Content-Type", register.contentType);
  register.metrics().then((data) => res.status(200).send(data));
}
