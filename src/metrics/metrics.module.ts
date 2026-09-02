import { Module } from '@nestjs/common';
import {
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';
import { CpsMetricsService } from './cps-metrics.service.js';
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
    makeCounterProvider({
      name: 'roseman_cps_raw_payload_bytes_total',
      help: 'Total bytes of raw CPS payloads in completed anchors',
    }),
    makeCounterProvider({
      name: 'roseman_cps_stored_records_total',
      help: 'Total canonical CPS records in completed anchors',
    }),
    makeCounterProvider({
      name: 'roseman_cps_invalid_signatures_total',
      help: 'Total invalid signatures in completed CPS anchors',
    }),
    makeCounterProvider({
      name: 'roseman_cps_unsupported_messages_total',
      help: 'Total unsupported messages in completed CPS anchors',
    }),
    makeCounterProvider({
      name: 'roseman_cps_private_sections_total',
      help: 'Total encrypted private sections in completed CPS anchors',
    }),
    makeCounterProvider({
      name: 'roseman_cps_projection_errors_total',
      help: 'Total CPS records affected by legacy projection errors',
    }),
    CpsMetricsService,
  ],
  exports: [MetricsService, CpsMetricsService],
})
export class MetricsModule {}
