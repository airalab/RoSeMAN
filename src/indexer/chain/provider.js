import { ApiPromise, WsProvider } from "@polkadot/api";
import config from "../../config";
import logger from "../../utils/logger";

export class Instance {
  constructor(endpoint, chainName = '') {
    this.provider = null;
    this.api = null;
    this.endpoint = endpoint;
    this.chainName = chainName;
  }

  setProvider() {
    if (this.provider) {
      return;
    }
    this.provider = new WsProvider(this.endpoint);
    this.provider.on("connected", () => {
      logger.info(`Connected provider ${this.endpoint}`);
    });
    this.provider.on("disconnected", () => {
      logger.warn(`Disconnected provider ${this.endpoint}`);
    });
    this.provider.on("error", (e) => {
      logger.error(`Error provider ${this.endpoint}: ${e.message}`);
    });
  }

  async create() {
    if (this.api) {
      return;
    }
    this.setProvider();
    this.api = await ApiPromise.create({
      provider: this.provider,
      types: config.CHAIN_TYPES,
    });
  }

  async getLastBlock() {
    return Number((await this.api.rpc.chain.getBlock()).block.header.number);
  }

  async disconnect() {
    await this.api.disconnect();
    await this.provider.disconnect();
    this.api = null;
    this.provider = null;
  }
}
