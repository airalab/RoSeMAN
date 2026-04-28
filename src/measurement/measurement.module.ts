import { Module } from '@nestjs/common';
import { IpfsFetcherService } from './ipfs-fetcher.service.js';
import { MeasurementProcessorService } from './measurement-processor.service.js';

@Module({
  providers: [IpfsFetcherService, MeasurementProcessorService],
})
export class MeasurementModule {}
