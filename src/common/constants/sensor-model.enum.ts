/**
 * Модель записи в legacy-коллекции measurements.
 * @deprecated Connectivity Protocol использует собственные protobuf-типы.
 */
export enum SensorModel {
  PING = 1,
  STATIC = 2,
  MOVE = 3,
  MESSAGE = 4,
  STORY = 5,
}

/**
 * Модели сенсоров с данными измерений (исключая MESSAGE).
 * @deprecated Используется только legacy Sensor API.
 */
export const SENSOR_DATA_MODELS = [SensorModel.STATIC, SensorModel.MOVE];
