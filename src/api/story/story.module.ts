import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { StoryController } from './story.controller.js';
import { StoryService } from './story.service.js';

/**
 * Предоставляет API историй, собранных через RWS.
 * @deprecated Актуальный CPS-поток не создаёт записи stories.
 */
@Module({
  controllers: [StoryController],
  providers: [StoryService],
})
export class StoryModule implements OnModuleInit {
  private readonly logger = new Logger(StoryModule.name);

  /** Сообщает оператору о запуске устаревшего Story API. */
  onModuleInit(): void {
    this.logger.warn(
      'Deprecated RWS Story API is active; it is retained only for existing clients',
    );
  }
}
