import { Module } from '@nestjs/common';
import { BlockIndexerService } from './block-indexer.service.js';
import { EVENT_HANDLERS, EXTRINSIC_HANDLERS } from './constants.js';
import { filterHandlers } from './handler-filter.js';
import { DatalogNewRecordHandler } from './handlers/datalog-new-record.handler.js';
import { RwsExtrinsicHandler } from './handlers/rws-extrinsic.handler.js';
import { RwsNewDevicesHandler } from './handlers/rws-new-devices.handler.js';
import { RwsStoryHandler } from './handlers/rws-story.handler.js';
import type { ChainEventHandler } from './interfaces/chain-event-handler.interface.js';
import type { ChainExtrinsicHandler } from './interfaces/chain-extrinsic-handler.interface.js';
import { RobonomicsService } from './robonomics.service.js';

@Module({
  providers: [
    RobonomicsService,
    DatalogNewRecordHandler,
    RwsNewDevicesHandler,
    RwsExtrinsicHandler,
    RwsStoryHandler,
    {
      provide: EVENT_HANDLERS,
      useFactory: (...handlers: ChainEventHandler[]) =>
        filterHandlers(handlers, 'event'),
      inject: [DatalogNewRecordHandler, RwsNewDevicesHandler],
    },
    {
      provide: EXTRINSIC_HANDLERS,
      useFactory: (...handlers: ChainExtrinsicHandler[]) =>
        filterHandlers(handlers, 'extrinsic'),
      inject: [RwsExtrinsicHandler, RwsStoryHandler],
    },
    BlockIndexerService,
  ],
  exports: [RobonomicsService],
})
export class RobonomicsModule {}
