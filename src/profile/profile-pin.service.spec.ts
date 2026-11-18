import { ConfigService } from '@nestjs/config';
import type { SensorProfileRepository } from '../database/repositories/sensor-profile.repository.js';
import { KuboError, type KuboClient } from './kubo-client.js';
import { ProfilePinService } from './profile-pin.service.js';

const SENSOR = '4TestSensorAddressForProfiLeSpecs1111111111111111';
const PROFILE = 'bafkreibnjwdiwglbadjq2ltodanyfydsyaynoqrmnqbgm5t3qp5z6u7kea';
const IMAGE = 'bafkreig52jdrrun3romjwbjsgq3zktwq33vvnttvnx2uepxadhkphsdki4';

const cfg = {
  pollInterval: 1000,
  batchSize: 5,
  pinTimeoutMs: 1000,
  maxAttempts: 3,
  retryBaseMs: 100,
  maxProfileBytes: 16384,
  maxImageBytes: 1000,
  maxImages: 3,
  maxDescriptionChars: 500,
};

function setup(kuboImpl: Partial<KuboClient>) {
  const repo = {
    markReady: jest.fn(),
    markRetry: jest.fn(),
    markFailed: jest.fn(),
  };
  const kubo = {
    cat: jest.fn(),
    dagSize: jest.fn(),
    pin: jest.fn(),
    ...kuboImpl,
  };
  const config = { get: () => cfg } as unknown as ConfigService;
  const svc = new ProfilePinService(
    config,
    repo as unknown as SensorProfileRepository,
    kubo as unknown as KuboClient,
  );
  return { svc, repo, kubo };
}

const json = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const pending = { sensor_id: SENSOR, cid: PROFILE, block: 100, attempts: 0 };

describe('ProfilePinService.processOne', () => {
  it('pins images, then profile.json, then marks ready', async () => {
    const order: string[] = [];
    const { svc, repo } = setup({
      cat: jest.fn().mockResolvedValue(
        json({
          v: 1,
          sensor: SENSOR,
          description: 'Балкон',
          images: [`ipfs://${IMAGE}`],
        }),
      ),
      dagSize: jest.fn().mockResolvedValue(500),
      pin: jest.fn().mockImplementation((cid: string) => {
        order.push(cid);
        return Promise.resolve();
      }),
    });
    await svc.processOne(pending);
    expect(order).toEqual([IMAGE, PROFILE]);
    expect(repo.markReady).toHaveBeenCalledWith(
      SENSOR,
      PROFILE,
      100,
      'Балкон',
      [IMAGE],
    );
  });

  it('fails at once on an invalid profile.json, without retries', async () => {
    const { svc, repo } = setup({
      cat: jest.fn().mockResolvedValue(json({ v: 1, sensor: 'someone-else' })),
    });
    await svc.processOne(pending);
    expect(repo.markFailed).toHaveBeenCalledWith(
      SENSOR,
      PROFILE,
      expect.stringContaining('another sensor'),
    );
    expect(repo.markRetry).not.toHaveBeenCalled();
  });

  it('fails an oversized image and pins nothing', async () => {
    const { svc, repo, kubo } = setup({
      cat: jest
        .fn()
        .mockResolvedValue(json({ v: 1, sensor: SENSOR, images: [IMAGE] })),
      dagSize: jest.fn().mockResolvedValue(5000),
    });
    await svc.processOne(pending);
    expect(kubo.pin).not.toHaveBeenCalled();
    expect(repo.markFailed).toHaveBeenCalledWith(
      SENSOR,
      PROFILE,
      expect.stringContaining('limit 1000'),
    );
  });

  it('retries with backoff while the phone is unreachable, then gives up', async () => {
    const { svc, repo } = setup({
      cat: jest
        .fn()
        .mockRejectedValue(
          new KuboError('kubo cat 500: context deadline exceeded'),
        ),
    });
    await svc.processOne({ ...pending, attempts: 0 });
    expect(repo.markRetry).toHaveBeenCalledWith(
      SENSOR,
      PROFILE,
      1,
      expect.any(Date),
      expect.stringContaining('deadline'),
    );
    await svc.processOne({ ...pending, attempts: 2 });
    expect(repo.markFailed).toHaveBeenCalledTimes(1);
  });
});
