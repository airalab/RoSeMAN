import { Module } from '@nestjs/common';
import { makeGaugeProvider } from '@willsoto/nestjs-prometheus';
import { MetricsService } from './metrics.service.js';

@Module({
  providers: [
    MetricsService,
    makeGaugeProvider({
      name: 'roseman_block_read',
      help: 'roseman_block_read Number of the last block read',
      labelNames: ['chain'],
    }),
    makeGaugeProvider({
      name: 'roseman_ipfs_queue',
      help: 'roseman_ipfs_queue Number of unprocessed ipfs hashes in queue',
    }),
  ],
  exports: [MetricsService],
})
export class MetricsModule {}
