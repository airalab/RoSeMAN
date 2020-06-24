import net from "net";
import worker from "./services/worker";
import config from "./config";

const client = net.createConnection(config.PORT_WORKER);

client.on("connect", function () {
  worker((item) => {
    client.write(
      Buffer.from(
        JSON.stringify({
          cmd: "new_point",
          data: {
            sensor_id: item.sensor_id,
            sender: item.sender,
            model: item.model,
            geo: item.geo,
            data: JSON.parse(item.data),
            timestamp: item.timestamp,
          },
        }) + "\n"
      )
    );
  })
    .then(() => {
      process.exit(0);
    })
    .catch(() => {
      process.exit(0);
    });
});
