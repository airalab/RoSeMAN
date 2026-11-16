import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class KuboError extends Error {
  constructor(message: string) {
    super(message);
    this.name = KuboError.name;
  }
}

/**
 * Minimal Kubo RPC client (POST /api/v0/...). Blocks a profile refers to are pulled by
 * Kubo over bitswap from whoever has them — normally the phone that just published,
 * still connected to this Kubo.
 */
@Injectable()
export class KuboClient {
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('profile.kuboApiUrl', 'http://ipfs:5001');
  }

  private async call(
    path: string,
    params: Record<string, string>,
    timeoutMs: number,
  ): Promise<Response> {
    const qs = new URLSearchParams(params);
    // Kubo's own timeout stops the bitswap wait; ours is a little longer to read its error.
    qs.set('timeout', `${Math.ceil(timeoutMs / 1000)}s`);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/v0/${path}?${qs}`, {
        method: 'POST',
        signal: AbortSignal.timeout(timeoutMs + 5000),
      });
    } catch (e) {
      throw new KuboError(`kubo ${path}: ${(e as Error).message}`);
    }
    if (!res.ok) {
      const text = (await res.text()).slice(0, 300);
      throw new KuboError(`kubo ${path} ${res.status}: ${text}`);
    }
    return res;
  }

  /** Total DAG size in bytes; fetches missing blocks. */
  async dagSize(cid: string, timeoutMs: number): Promise<number> {
    const res = await this.call(
      'dag/stat',
      { arg: cid, progress: 'false' },
      timeoutMs,
    );
    const body = (await res.json()) as { Size?: number; TotalSize?: number };
    const size = body.TotalSize ?? body.Size;
    if (typeof size !== 'number') throw new KuboError('kubo dag/stat: no size');
    return size;
  }

  /** Reads a file, refusing more than maxBytes. */
  async cat(
    cid: string,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    const res = await this.call(
      'cat',
      { arg: cid, length: String(maxBytes + 1) },
      timeoutMs,
    );
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > maxBytes)
      throw new KuboError(`kubo cat: ${cid} is larger than ${maxBytes} bytes`);
    return bytes;
  }

  async pin(cid: string, timeoutMs: number): Promise<void> {
    await this.call(
      'pin/add',
      { arg: cid, recursive: 'true', progress: 'false' },
      timeoutMs,
    );
  }

  /** Streams a local (pinned) file for the read API. */
  async stream(
    cid: string,
    maxBytes: number,
    timeoutMs: number,
  ): Promise<Response> {
    return this.call(
      'cat',
      { arg: cid, length: String(maxBytes), offline: 'true' },
      timeoutMs,
    );
  }
}
