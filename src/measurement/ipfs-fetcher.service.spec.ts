import type { ConfigService } from '@nestjs/config';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';

describe('IpfsFetcherService', () => {
  const gateways = [
    'https://first.example/ipfs/',
    'https://second.example/ipfs/',
  ];
  const cid = `b${'a'.repeat(58)}`;
  let service: IpfsFetcherService;

  beforeEach(() => {
    service = createService();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  /**
   * Создаёт сервис с управляемым лимитом ответа.
   * @param maxResponseBytes - максимальный размер IPFS-ответа
   * @returns экземпляр IPFS-сервиса
   */
  function createService(maxResponseBytes = 1_024): IpfsFetcherService {
    const config = {
      get: jest.fn((key: string) => {
        if (key === 'ipfs.gateways') return gateways;
        if (key === 'ipfs.fetchTimeout') return 1_000;
        if (key === 'ipfs.maxResponseBytes') return maxResponseBytes;
        return undefined;
      }),
    } as unknown as ConfigService;

    return new IpfsFetcherService(config);
  }

  /** Возвращает JSON через существующий совместимый метод fetch. */
  it('fetches JSON content', async () => {
    const payload = { sensor: 'value' };
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(payload), { status: 200 }),
      );

    await expect(service.fetch(`${cid}/data.json`)).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`${gateways[0]}${cid}/data.json`);
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /** Возвращает точные бинарные байты без JSON-декодирования. */
  it('fetches binary content', async () => {
    const payload = Uint8Array.from([0, 1, 127, 128, 255]);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(payload, { status: 200 }));

    await expect(service.fetchBytes(cid)).resolves.toEqual(payload);
  });

  /** Переходит к следующему gateway после неуспешного HTTP-ответа. */
  it('falls back to the next gateway', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(
        new Response(Uint8Array.from([42]), { status: 200 }),
      );

    await expect(service.fetchBytes(cid)).resolves.toEqual(
      Uint8Array.from([42]),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(`${gateways[1]}${cid}`);
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  /** Возвращает общую ошибку, если ни один gateway не ответил успешно. */
  it('throws after all gateways fail', async () => {
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(service.fetchBytes(cid)).rejects.toThrow(
      `All IPFS gateways failed for CID ${cid}`,
    );
  });

  /** Не выполняет сетевой запрос для неверного CID или опасного пути. */
  it('rejects invalid CID and unsafe paths', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch');

    await expect(service.fetchBytes('bafy-invalid')).rejects.toThrow(
      'Invalid IPFS CID or path',
    );
    await expect(service.fetchBytes(`${cid}/../secret`)).rejects.toThrow(
      'Invalid IPFS CID or path',
    );
    await expect(service.fetchBytes(`${cid}/%2e%2e/secret`)).rejects.toThrow(
      'Invalid IPFS CID or path',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /** Останавливает поток, как только ответ превышает настроенный лимит. */
  it('rejects a streaming response that exceeds the size limit', async () => {
    service = createService(4);
    jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(Uint8Array.from([1, 2, 3, 4, 5]), { status: 200 }),
      );

    await expect(service.fetchBytes(cid)).rejects.toThrow(
      `IPFS response for ${cid} exceeds 4 bytes`,
    );
  });

  /** Сохраняет timeout до чтения тела и переходит на следующий gateway. */
  it('falls back after response body timeout', async () => {
    jest.useFakeTimers();
    const payload = Uint8Array.from([7, 8, 9]);
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementationOnce((_input, init) => {
        const signal = init?.signal;
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            signal?.addEventListener(
              'abort',
              () =>
                controller.error(
                  new DOMException('The operation was aborted', 'AbortError'),
                ),
              { once: true },
            );
          },
        });
        return Promise.resolve(new Response(body, { status: 200 }));
      })
      .mockResolvedValueOnce(new Response(payload, { status: 200 }));

    const resultPromise = service.fetchBytes(cid);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(resultPromise).resolves.toEqual(payload);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
