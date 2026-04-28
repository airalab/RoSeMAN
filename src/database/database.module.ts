import { Global, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Datalog, DatalogSchema } from './schemas/datalog.schema.js';
import { IndexState, IndexStateSchema } from './schemas/index-state.schema.js';
import {
  Measurement,
  MeasurementSchema,
} from './schemas/measurement.schema.js';
import { Sensor, SensorSchema } from './schemas/sensor.schema.js';
import { Story, StorySchema } from './schemas/story.schema.js';
import {
  Subscription,
  SubscriptionSchema,
} from './schemas/subscription.schema.js';
import { DatalogRepository } from './repositories/datalog.repository.js';
import { IndexStateRepository } from './repositories/index-state.repository.js';
import { MeasurementRepository } from './repositories/measurement.repository.js';
import { SensorRepository } from './repositories/sensor.repository.js';
import { StoryRepository } from './repositories/story.repository.js';
import { SubscriptionRepository } from './repositories/subscription.repository.js';

/**
 * Глобальный модуль базы данных.
 * Регистрирует все Mongoose-схемы и предоставляет репозитории
 * для доступа к данным из любого модуля приложения.
 */
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Datalog.name, schema: DatalogSchema },
      { name: IndexState.name, schema: IndexStateSchema },
      { name: Measurement.name, schema: MeasurementSchema },
      { name: Sensor.name, schema: SensorSchema },
      { name: Story.name, schema: StorySchema },
      { name: Subscription.name, schema: SubscriptionSchema },
    ]),
  ],
  providers: [
    DatalogRepository,
    IndexStateRepository,
    MeasurementRepository,
    SensorRepository,
    StoryRepository,
    SubscriptionRepository,
  ],
  exports: [
    DatalogRepository,
    IndexStateRepository,
    MeasurementRepository,
    SensorRepository,
    StoryRepository,
    SubscriptionRepository,
  ],
})
export class DatabaseModule {}
