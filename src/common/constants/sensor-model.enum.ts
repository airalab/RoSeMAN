export enum SensorModel {
  PING = 1,
  STATIC = 2,
  MOVE = 3,
  MESSAGE = 4,
  STORY = 5,
}

/** Модели сенсоров с данными измерений (исключая MESSAGE). */
export const SENSOR_DATA_MODELS = [SensorModel.STATIC, SensorModel.MOVE];
