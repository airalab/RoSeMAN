import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiPromise, WsProvider } from '@polkadot/api';

@Injectable()
export class RobonomicsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RobonomicsService.name);
  private apiPromise!: Promise<ApiPromise>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    const api = await this.apiPromise;
    if (api) {
      this.logger.log('Disconnecting from Robonomics');
      await api.disconnect();
    }
  }

  /**
   * Отключает текущее соединение и создаёт новое.
   */
  async reconnect(): Promise<void> {
    try {
      const api = await this.apiPromise;
      await api.disconnect();
    } catch {
      // ignore errors on stale connection
    }
    this.connect();
  }

  async getApi(): Promise<ApiPromise> {
    return this.apiPromise;
  }

  private connect(): void {
    const wsEndpoint = this.config.get<string>('robonomics.wsEndpoint')!;
    this.logger.log(`Connecting to Robonomics at ${wsEndpoint}`);

    const provider = new WsProvider(wsEndpoint);
    this.apiPromise = ApiPromise.create({ provider }).then(async (api) => {
      this.logger.log(
        `Connected to chain ${(await api.rpc.system.chain()).toString()}`,
      );
      return api;
    });
  }
}
