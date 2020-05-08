import net from "net";
import worker from "./services/worker";
import config from "./config";

const client = net.createConnection(config.PORT_WORKER);

client.on("connect", function () {
  worker((item) => {
    client.write(
      Buffer.from(
        JSON.stringify({
          sender: item.sender,
          geo: item.geo,
          data: JSON.parse(item.data),
          timestamp: item.timechain,
        })
      )
    );
  }).then(() => {
    process.exit(0);
  });
});
