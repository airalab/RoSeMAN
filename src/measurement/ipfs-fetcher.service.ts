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

  async fetch(cid: string): Promise<unknown> {
    for (const gateway of this.gateways) {
      const url = `${gateway}${cid}`;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeout);

        const response = await globalThis.fetch(url, {
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!response.ok) {
          this.logger.warn(
            `Gateway ${gateway} returned ${response.status} for ${cid}`,
          );
          continue;
        }

        return (await response.json()) as unknown;
      } catch (err) {
        this.logger.warn(
          `Gateway ${gateway} failed for ${cid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    throw new Error(`All IPFS gateways failed for CID ${cid}`);
  }
}
