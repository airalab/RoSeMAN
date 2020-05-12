import net from "net";
import worker from "./services/worker";
import config from "./config";

const client = net.createConnection(config.PORT_WORKER);

client.on("connect", function () {
  worker((item) => {
    const data = JSON.parse(item.data);
    const timestamp = data.timestamp + "000";
    delete data.timestamp;
    client.write(
      Buffer.from(
        JSON.stringify({
          sender: item.sender,
          geo: item.geo,
          data: data,
          timestamp,
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
