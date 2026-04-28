import { Module } from '@nestjs/common';
import { StoryController } from './story.controller.js';
import { StoryService } from './story.service.js';

@Module({
  controllers: [StoryController],
  providers: [StoryService],
})
export class StoryModule {}
