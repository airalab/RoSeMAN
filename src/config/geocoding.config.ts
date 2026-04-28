import { registerAs } from '@nestjs/config';

export default registerAs('geocoding', () => ({
  baseUrl:
    process.env.NOMINATIM_BASE_URL ||
    'https://nominatim.openstreetmap.org/reverse',
  userAgent: process.env.NOMINATIM_USER_AGENT || 'RoSeMAN/1.0',
  requestInterval: parseInt(
    process.env.NOMINATIM_REQUEST_INTERVAL || '1100',
    10,
  ),
  pollInterval: parseInt(process.env.GEOCODING_POLL_INTERVAL || '30000', 10),
  fetchTimeout: parseInt(process.env.NOMINATIM_FETCH_TIMEOUT || '10000', 10),
  batchSize: parseInt(process.env.GEOCODING_BATCH_SIZE || '10', 10),
}));
