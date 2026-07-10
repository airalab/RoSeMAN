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
  private api?: ApiPromise;
  private connectPromise?: Promise<ApiPromise>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.connect();
  }

  async onModuleDestroy(): Promise<void> {
    const api = this.api;
    if (api) {
      this.logger.log('Disconnecting from Robonomics');
      await api.disconnect();
    }
  }

  /**
   * Отключает текущее соединение и создаёт новое.
   * Старый экземпляр ApiPromise заменяется до отключения, чтобы подписчики,
   * вызвавшие getApi(), не получили уже отключаемое соединение.
   */
  async reconnect(): Promise<void> {
    this.logger.log('Reconnecting to Robonomics...');

    const staleApi = this.api;
    this.api = undefined;
    this.connectPromise = undefined;

    if (staleApi) {
      try {
        await staleApi.disconnect();
      } catch {
        // ignore errors on stale connection
      }
    }

    this.connect();
    await this.getApi();
  }

  /**
   * Возвращает актуальный подключённый ApiPromise.
   * Если текущий API не подключён, ожидает инициализации нового соединения.
   */
  async getApi(): Promise<ApiPromise> {
    if (this.api?.isConnected) {
      return this.api;
    }

    if (!this.connectPromise) {
      this.connect();
    }

    return this.connectPromise!;
  }

  private connect(): void {
    const wsEndpoint = this.config.get<string>('robonomics.wsEndpoint')!;
    this.logger.log(`Connecting to Robonomics at ${wsEndpoint}`);

    const provider = new WsProvider(wsEndpoint);
    this.connectPromise = ApiPromise.create({ provider }).then(async (api) => {
      this.api = api;
      this.logger.log(
        `Connected to chain ${(await api.rpc.system.chain()).toString()}`,
      );
      return api;
    });
  }
}
