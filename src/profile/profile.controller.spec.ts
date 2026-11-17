import { ConfigService } from '@nestjs/config';
import type { SensorProfileRepository } from '../database/repositories/sensor-profile.repository.js';
import type { KuboClient } from './kubo-client.js';
import { ProfileController } from './profile.controller.js';

function controller(kuboP2p: string[]) {
  const config = {
    get: (key: string) => (key === 'profile.kuboP2p' ? kuboP2p : undefined),
  } as unknown as ConfigService;
  return new ProfileController(
    config,
    {} as SensorProfileRepository,
    {} as KuboClient,
  );
}

describe('GET /api/v2/profile/node', () => {
  it('tells the phone where to hand over the photos', () => {
    const addr =
      '/dns4/roseman.example/tcp/443/wss/p2p/12D3KooWDjv73TxiuxMQVPHYQmHr3uNjbUZuAMpbmzfevXonQvgC';
    expect(controller([addr]).node()).toEqual({
      result: { multiaddrs: [addr] },
    });
  });

  it('answers with no addresses when this RoSeMAN takes no uploads', () => {
    expect(controller([]).node()).toEqual({ result: { multiaddrs: [] } });
  });
});
