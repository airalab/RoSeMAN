import logger from "../../utils/logger";
import { disconnect } from "./provider";
import { init, reader } from "./reader";

export default async function chain() {
  try {
    const { api, startBlock } = await init();
    try {
      await reader(api, startBlock);
    } catch (error) {
      logger.error(`reader ${api.isConnected} | ${error.message}`);
      await disconnect();
      setTimeout(() => {
        logger.info("Restart reader");
        chain();
      }, 15000);
    }
  } catch (error) {
    logger.error(`reader init ${error.message}`);
  }
}
