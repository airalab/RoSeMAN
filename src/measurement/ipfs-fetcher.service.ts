import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class IpfsFetcherService {
  private readonly logger = new Logger(IpfsFetcherService.name);
  private readonly gateways: string[];
  private readonly timeout: number;

  constructor(private readonly config: ConfigService) {
    this.gateways = this.config.get<string[]>('ipfs.gateways')!;
    this.timeout = this.config.get<number>('ipfs.fetchTimeout')!;
  }

  /**
   * Загружает IPFS-объект и декодирует его как JSON.
   * Сохраняет совместимость с существующим обработчиком datalog.
   * @param cid - CID или путь внутри IPFS
   * @returns декодированное JSON-значение
   */
  async fetch(cid: string): Promise<unknown> {
    const response = await this.fetchResponse(cid);
    return (await response.json()) as unknown;
  }

  /**
   * Загружает IPFS-объект без преобразования его бинарного содержимого.
   * Используется для protobuf batch, подпись и CID которых зависят от точных байтов.
   * @param cid - CID или путь внутри IPFS
   * @returns неизменённые байты ответа IPFS gateway
   */
  async fetchBytes(cid: string): Promise<Uint8Array> {
    const response = await this.fetchResponse(cid);
    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Запрашивает IPFS-объект, последовательно перебирая настроенные gateways.
   * Таймер каждого запроса очищается независимо от результата.
   * @param cid - CID или путь внутри IPFS
   * @returns первый успешный HTTP-ответ
   */
  private async fetchResponse(cid: string): Promise<Response> {
    for (const gateway of this.gateways) {
      const url = `${gateway}${cid}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await globalThis.fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          this.logger.warn(
            `Gateway ${gateway} returned ${response.status} for ${cid}`,
          );
          continue;
        }

        return response;
      } catch (err) {
        this.logger.warn(
          `Gateway ${gateway} failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`All IPFS gateways failed for CID ${cid}`);
  }
}
