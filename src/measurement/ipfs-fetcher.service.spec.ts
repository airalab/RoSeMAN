import type { ConfigService } from '@nestjs/config';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';

describe('IpfsFetcherService', () => {
  const gateways = [
    'https://first.example/ipfs/',
    'https://second.example/ipfs/',
  ];
  let service: IpfsFetcherService;

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ipfs.gateways') return gateways;
        if (key === 'ipfs.fetchTimeout') return 1_000;
        return undefined;
      }),
    } as unknown as ConfigService;

    service = new IpfsFetcherService(config);
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /** Возвращает JSON через существующий совместимый метод fetch. */
  it('fetches JSON content', async () => {
    const payload = { sensor: 'value' };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );

    await expect(service.fetch('bafy-json')).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${gateways[0]}bafy-json`);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /** Возвращает точные бинарные байты без JSON-декодирования. */
  it('fetches binary content', async () => {
    const payload = Uint8Array.from([0, 1, 127, 128, 255]);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(payload, { status: 200 }));

    await expect(service.fetchBytes('bafy-binary')).resolves.toEqual(payload);
  });

  /** Переходит к следующему gateway после неуспешного HTTP-ответа. */
  it('falls back to the next gateway', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([42]), { status: 200 }),
      );

    await expect(service.fetchBytes('bafy-fallback')).resolves.toEqual(
      Uint8Array.from([42]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${gateways[1]}bafy-fallback`);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /** Возвращает общую ошибку, если ни один gateway не ответил успешно. */
  it('throws after all gateways fail', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(service.fetchBytes('bafy-missing')).rejects.toThrow(
      'All IPFS gateways failed for CID bafy-missing',
    );
  });
});
