import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { CID } from 'multiformats/cid';
import { SensorProfileRepository } from '../database/repositories/sensor-profile.repository.js';
import { KuboClient } from './kubo-client.js';

export interface SensorProfileView {
  sensor_id: string;
  owner: string;
  description: string;
  /** CIDs; fetch bytes from GET /api/v2/profile/image/:cid */
  images: string[];
  block: number | null;
  /** State of the latest submission: pending while the phone is still uploading. */
  status: string;
  pending_cid: string | null;
  error: string | null;
}

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

function sniffType(head: Uint8Array): string {
  if (head[0] === 0xff && head[1] === 0xd8) return 'image/jpeg';
  if (head[0] === 0x89 && head[1] === 0x50) return 'image/png';
  if (
    head[8] === 0x57 &&
    head[9] === 0x45 &&
    head[10] === 0x42 &&
    head[11] === 0x50
  )
    return 'image/webp';
  return 'application/octet-stream';
}

@Controller('v2/profile')
export class ProfileController {
  constructor(
    private readonly config: ConfigService,
    private readonly profiles: SensorProfileRepository,
    private readonly kubo: KuboClient,
  ) {}

  @Get('node')
  node(): { result: { multiaddrs: string[] } } {
    return {
      result: { multiaddrs: this.config.get<string[]>('profile.kuboP2p', []) },
    };
  }

  @Get('image/:cid')
  async image(
    @Param('cid') cidParam: string,
    @Res() res: Response,
  ): Promise<void> {
    let cid: string;
    try {
      cid = CID.parse(cidParam).toV1().toString();
    } catch {
      throw new NotFoundException();
    }
    // Only images of a shown profile: this is not an open IPFS gateway.
    if (!(await this.profiles.isShownImage(cid))) throw new NotFoundException();
    const upstream = await this.kubo.stream(cid, MAX_IMAGE_BYTES, 15000);
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    res
      .status(200)
      .setHeader('Content-Type', sniffType(bytes.subarray(0, 12)))
      .setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .send(Buffer.from(bytes));
  }

  @Get(':sensor_id')
  async get(
    @Param('sensor_id') sensorId: string,
  ): Promise<{ result: SensorProfileView | null }> {
    const p = await this.profiles.findBySensor(sensorId);
    if (!p) return { result: null };
    return {
      result: {
        sensor_id: p.sensor_id,
        owner: p.owner,
        description: p.ready_cid ? p.description : '',
        images: p.ready_cid ? p.images : [],
        block: p.ready_block ?? null,
        status: p.status,
        pending_cid: p.cid !== p.ready_cid ? p.cid : null,
        error: p.error ?? null,
      },
    };
  }
}
