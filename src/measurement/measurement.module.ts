import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module.js';
import { CpsAnchorProcessorService } from './cps-anchor-processor.service.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { ConnectivityRecordMapper } from './connectivity-record.mapper.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { MeasurementProcessorService } from './measurement-processor.service.js';

@Module({
  imports: [MetricsModule],
  providers: [
    IpfsFetcherService,
    MeasurementProcessorService,
    CpsMeasurementTransformer,
    ConnectivityRecordMapper,
    CpsAnchorProcessorService,
  ],
})
export class MeasurementModule {}
