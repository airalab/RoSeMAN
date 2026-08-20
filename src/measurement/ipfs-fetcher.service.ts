import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isIpfsCid } from '../common/utils/ipfs.util.js';
import { DEFAULT_IPFS_MAX_RESPONSE_BYTES } from '../config/ipfs.config.js';

class IpfsResponseTooLargeError extends Error {}

@Injectable()
export class IpfsFetcherService {
  private readonly logger = new Logger(IpfsFetcherService.name);
  private readonly gateways: string[];
  private readonly timeout: number;
  private readonly maxResponseBytes: number;

  constructor(private readonly config: ConfigService) {
    this.gateways = this.config.get<string[]>('ipfs.gateways')!;
    this.timeout = this.config.get<number>('ipfs.fetchTimeout')!;
    this.maxResponseBytes =
      this.config.get<number>('ipfs.maxResponseBytes') ??
      DEFAULT_IPFS_MAX_RESPONSE_BYTES;
  }

  /**
   * Загружает IPFS-объект и декодирует его как JSON.
   * Сохраняет совместимость с существующим обработчиком datalog.
   * @param cid - CID или путь внутри IPFS
   * @returns декодированное JSON-значение
   */
  async fetch(cid: string): Promise<unknown> {
    const bytes = await this.fetchBytes(cid);
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  }

  /**
   * Загружает IPFS-объект без преобразования его бинарного содержимого.
   * Используется для protobuf batch, подпись и CID которых зависят от точных байтов.
   * @param cid - CID или путь внутри IPFS
   * @returns неизменённые байты ответа IPFS gateway
   */
  async fetchBytes(cid: string): Promise<Uint8Array> {
    this.assertValidIpfsPath(cid);
    return this.fetchResponseBytes(cid);
  }

  /**
   * Запрашивает и читает IPFS-объект, последовательно перебирая gateways.
   * Timeout действует до полного чтения тела ответа.
   * @param cid - CID или путь внутри IPFS
   * @returns байты первого успешно прочитанного ответа
   */
  private async fetchResponseBytes(cid: string): Promise<Uint8Array> {
    let lastError = 'unknown error';

    for (const gateway of this.gateways) {
      const url = `${gateway}${cid}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeout);

      try {
        const response = await globalThis.fetch(url, {
          signal: controller.signal,
        });

        if (!response.ok) {
          lastError = `HTTP ${response.status} from ${gateway}`;
          this.logger.warn(
            `Gateway ${gateway} returned ${response.status} for ${cid}`,
          );
          await response.body?.cancel().catch(() => undefined);
          continue;
        }

        return await this.readResponseBytes(response, cid);
      } catch (err) {
        if (err instanceof IpfsResponseTooLargeError) {
          throw err;
        }

        lastError = controller.signal.aborted
          ? `timeout after ${this.timeout}ms at ${gateway}`
          : err instanceof Error
            ? err.message
            : String(err);
        this.logger.warn(`Gateway ${gateway} failed for ${cid}: ${lastError}`);
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`All IPFS gateways failed for CID ${cid}: ${lastError}`);
  }

  /**
   * Читает тело ответа потоково и останавливается при превышении лимита.
   * @param response - успешный HTTP-ответ gateway
   * @param cid - CID или путь для диагностического сообщения
   * @returns объединённые байты ответа
   */
  private async readResponseBytes(
    response: Response,
    cid: string,
  ): Promise<Uint8Array> {
    const contentLength = response.headers.get('content-length');
    if (contentLength && /^\d+$/.test(contentLength)) {
      if (BigInt(contentLength) > BigInt(this.maxResponseBytes)) {
        await response.body?.cancel().catch(() => undefined);
        throw this.createResponseTooLargeError(cid);
      }
    }

    if (!response.body) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      this.assertResponseSize(bytes.byteLength, cid);
      return bytes;
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        totalBytes += value.byteLength;
        if (totalBytes > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw this.createResponseTooLargeError(cid);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const result = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  /**
   * Проверяет синтаксис CID и необязательного безопасного пути внутри IPFS.
   * @param value - CID либо строка вида `CID/path/to/file`
   */
  private assertValidIpfsPath(value: string): void {
    const [cid, ...segments] = value.split('/');
    if (!cid || !isIpfsCid(cid)) {
      throw new Error(`Invalid IPFS CID or path: ${value}`);
    }

    for (const segment of segments) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        throw new Error(`Invalid IPFS CID or path: ${value}`);
      }

      if (
        !decoded ||
        decoded === '.' ||
        decoded === '..' ||
        decoded.includes('/') ||
        decoded.includes('\\') ||
        decoded.includes('?') ||
        decoded.includes('#')
      ) {
        throw new Error(`Invalid IPFS CID or path: ${value}`);
      }
    }
  }

  /**
   * Проверяет фактический размер уже прочитанного ответа.
   * @param size - размер ответа в байтах
   * @param cid - CID или путь для диагностического сообщения
   */
  private assertResponseSize(size: number, cid: string): void {
    if (size > this.maxResponseBytes) {
      throw this.createResponseTooLargeError(cid);
    }
  }

  /**
   * Создаёт единообразную ошибку превышения лимита IPFS-ответа.
   * @param cid - CID или путь для диагностического сообщения
   * @returns ошибка с настроенным лимитом
   */
  private createResponseTooLargeError(cid: string): IpfsResponseTooLargeError {
    return new IpfsResponseTooLargeError(
      `IPFS response for ${cid} exceeds ${this.maxResponseBytes} bytes`,
    );
  }
}
