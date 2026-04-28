import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectMetric } from '@willsoto/nestjs-prometheus';
import { Gauge } from 'prom-client';
import { DatalogRepository } from '../database/repositories/datalog.repository.js';
import { IndexStateRepository } from '../database/repositories/index-state.repository.js';

@Injectable()
export class MetricsService implements OnModuleInit, OnModuleDestroy {
  private timeoutId?: NodeJS.Timeout;
  private isRunning = false;

  constructor(
    @InjectMetric('roseman_block_read')
    private readonly blockRead: Gauge<string>,

    @InjectMetric('roseman_ipfs_queue')
    private readonly ipfsQueue: Gauge<string>,

    private readonly datalogRepository: DatalogRepository,
    private readonly indexStateRepository: IndexStateRepository,
  ) {}

  onModuleInit() {
    this.isRunning = true;
    this.scheduleNext();
  }

  private scheduleNext() {
    this.timeoutId = setTimeout(() => void this.syncMetric(), 5000);
  }

  onModuleDestroy() {
    this.isRunning = false;
    clearTimeout(this.timeoutId);
  }

  private async syncMetric() {
    try {
      const count = await this.datalogRepository.getCountIpfsPending();
      this.setIpfsQueue(count);

      const indexes = await this.indexStateRepository.getAllIndex();
      for (const index of indexes) {
        this.setBlockRead(index.value, index.key);
      }
    } catch {
      // ignore errors on stale connection
    } finally {
      if (this.isRunning) {
        this.scheduleNext(); // следующий вызов только после завершения текущего
      }
    }
  }

  setBlockRead(block: number, chain: string) {
    this.blockRead.set({ chain }, block);
  }

  setIpfsQueue(count: number) {
    this.ipfsQueue.set(count);
  }
}
