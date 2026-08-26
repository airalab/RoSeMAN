import { Module } from '@nestjs/common';
import { CpsAnchorProcessorService } from './cps-anchor-processor.service.js';
import { CpsMeasurementTransformer } from './cps-measurement.transformer.js';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { MeasurementProcessorService } from './measurement-processor.service.js';

@Module({
  providers: [
    IpfsFetcherService,
    MeasurementProcessorService,
    CpsMeasurementTransformer,
    CpsAnchorProcessorService,
  ],
})
export class MeasurementModule {}
