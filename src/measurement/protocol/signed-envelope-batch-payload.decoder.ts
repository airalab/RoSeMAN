import { inflate } from 'node:zlib';
import { createDecompressor } from 'lzma-native';
import { SignedEnvelopeBatchDecoder } from './signed-envelope-batch.decoder.js';
import {
  ProtocolBatchDecodeError,
  ProtocolBatchDecodeErrorCode,
  type SignedEnvelopeBatchDecodeResult,
} from './signed-envelope.types.js';

export const DEFAULT_MAX_COMPRESSED_PROTOCOL_BATCH_BYTES = 10 * 1024 * 1024;

/**
 * Явно заданный wire format объекта, полученного из IPFS.
 */
export enum ProtocolBatchWireFormat {
  Raw = 'raw',
  Xz = 'xz',
  Zlib = 'zlib',
}

/**
 * Ограничения декодирования raw или zlib payload.
 */
export interface SignedEnvelopeBatchPayloadDecoderOptions {
  readonly maxCompressedBytes?: number;
  readonly maxDecompressedBytes?: number;
  readonly maxXzMemoryBytes?: number;
  readonly maxEnvelopeCount?: number;
}

/**
 * Распаковывает явно указанный wire format и передаёт точные protobuf-байты декодеру.
 */
export class SignedEnvelopeBatchPayloadDecoder {
  private readonly maxCompressedBytes: number;
  private readonly maxDecompressedBytes: number;
  private readonly maxXzMemoryBytes: number;
  private readonly batchDecoder: SignedEnvelopeBatchDecoder;

  /**
   * Создаёт payload-декодер с независимыми лимитами сжатого и распакованного тела.
   * @param options - ограничения размера и числа конвертов
   */
  constructor(options: SignedEnvelopeBatchPayloadDecoderOptions = {}) {
    this.maxCompressedBytes =
      options.maxCompressedBytes ?? DEFAULT_MAX_COMPRESSED_PROTOCOL_BATCH_BYTES;
    this.maxDecompressedBytes =
      options.maxDecompressedBytes ??
      DEFAULT_MAX_COMPRESSED_PROTOCOL_BATCH_BYTES;
    this.maxXzMemoryBytes = options.maxXzMemoryBytes ?? 64 * 1024 * 1024;

    if (
      !Number.isSafeInteger(this.maxCompressedBytes) ||
      !Number.isSafeInteger(this.maxDecompressedBytes) ||
      !Number.isSafeInteger(this.maxXzMemoryBytes) ||
      this.maxCompressedBytes <= 0 ||
      this.maxDecompressedBytes <= 0 ||
      this.maxXzMemoryBytes <= 0
    ) {
      throw new RangeError('Protocol payload limits must be positive');
    }

    this.batchDecoder = new SignedEnvelopeBatchDecoder({
      maxBatchBytes: this.maxDecompressedBytes,
      maxEnvelopeCount: options.maxEnvelopeCount,
    });
  }

  /**
   * Декодирует raw protobuf либо предварительно распаковывает zlib.
   * Формат задаётся вызывающей стороной, чтобы не принимать данные по эвристике.
   * @param bytes - неизменённый IPFS payload
   * @param format - подтверждённый wire format payload
   * @returns структурно проверенные недоверенные конверты и ошибки элементов
   */
  async decode(
    bytes: Uint8Array,
    format: ProtocolBatchWireFormat,
  ): Promise<SignedEnvelopeBatchDecodeResult> {
    if (format === ProtocolBatchWireFormat.Raw) {
      return this.batchDecoder.decode(bytes);
    }

    if (
      format !== ProtocolBatchWireFormat.Xz &&
      format !== ProtocolBatchWireFormat.Zlib
    ) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.UnsupportedWireFormat,
        'Signed envelope batch wire format is not supported',
      );
    }

    this.assertCompressedSize(bytes);
    const decompressedBytes =
      format === ProtocolBatchWireFormat.Xz
        ? await this.decompressXz(bytes)
        : await this.inflateZlib(bytes);
    return this.batchDecoder.decode(decompressedBytes);
  }

  /**
   * Проверяет размер сжатого payload до передачи в zlib.
   * @param bytes - сжатые входные байты
   */
  private assertCompressedSize(bytes: Uint8Array): void {
    if (bytes.byteLength > this.maxCompressedBytes) {
      throw new ProtocolBatchDecodeError(
        ProtocolBatchDecodeErrorCode.CompressedBatchTooLarge,
        `Compressed signed envelope batch exceeds ${this.maxCompressedBytes} bytes`,
      );
    }
  }

  /**
   * Асинхронно распаковывает zlib payload с ограничением выходного буфера.
   * @param bytes - сжатые байты batch
   * @returns распакованные protobuf-байты
   */
  private inflateZlib(bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      inflate(
        bytes,
        { maxOutputLength: this.maxDecompressedBytes },
        (error, result) => {
          if (!error) {
            resolve(new Uint8Array(result));
            return;
          }

          const code =
            'code' in error && typeof error.code === 'string'
              ? error.code
              : undefined;
          const limitExceeded = code === 'ERR_BUFFER_TOO_LARGE';
          reject(
            new ProtocolBatchDecodeError(
              limitExceeded
                ? ProtocolBatchDecodeErrorCode.BatchTooLarge
                : ProtocolBatchDecodeErrorCode.DecompressionFailed,
              limitExceeded
                ? `Decompressed signed envelope batch exceeds ${this.maxDecompressedBytes} bytes`
                : 'Signed envelope batch cannot be decompressed as zlib',
              { cause: error },
            ),
          );
        },
      );
    });
  }

  /**
   * Потоково распаковывает XZ/LZMA2 с лимитами памяти декодера и результата.
   * @param bytes - XZ-байты, созданные connectivity ipfs-publisher
   * @returns распакованные protobuf-байты
   */
  private decompressXz(bytes: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const decompressor = createDecompressor({
        memlimit: this.maxXzMemoryBytes,
      });
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      let settled = false;

      /**
       * Завершает распаковку типизированной ошибкой только один раз.
       * @param error - ошибка для возврата вызывающей стороне
       */
      const fail = (error: ProtocolBatchDecodeError): void => {
        if (settled) return;
        settled = true;
        reject(error);
        decompressor.destroy();
      };

      decompressor.on('data', (chunk: Buffer) => {
        totalBytes += chunk.byteLength;
        if (totalBytes > this.maxDecompressedBytes) {
          fail(
            new ProtocolBatchDecodeError(
              ProtocolBatchDecodeErrorCode.BatchTooLarge,
              `Decompressed signed envelope batch exceeds ${this.maxDecompressedBytes} bytes`,
            ),
          );
          return;
        }
        chunks.push(new Uint8Array(chunk));
      });

      decompressor.once('error', (error: Error) => {
        fail(
          new ProtocolBatchDecodeError(
            ProtocolBatchDecodeErrorCode.DecompressionFailed,
            'Signed envelope batch cannot be decompressed as XZ',
            { cause: error },
          ),
        );
      });

      decompressor.once('end', () => {
        if (settled) return;
        settled = true;

        const result = new Uint8Array(totalBytes);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.byteLength;
        }
        resolve(result);
      });

      decompressor.end(
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    });
  }
}
