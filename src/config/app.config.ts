import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  mongodbUri: process.env.MONGODB_URI || 'mongodb://localhost:27017/roseman',
  indexerEnabled: process.env.INDEXER_ENABLED !== 'false',
  apiEnabled: process.env.API_ENABLED !== 'false',
  measurementEnabled: process.env.MEASUREMENT_ENABLED !== 'false',
  geocodingEnabled: process.env.GEOCODING_ENABLED !== 'false',
  maxPeriodDays: parseInt(process.env.MAX_PERIOD_DAYS || '31', 10),
}));
