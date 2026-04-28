# RoSeMAN API Endpoints

> Глобальный префикс: `/api` (настроен в `src/main.ts`)

## Status Controller

**Файл:** `src/api/status/status.controller.ts`
**Префикс:** `status`

| Метод | Путь | Хендлер | Описание |
|-------|------|---------|----------|
| GET | `/api/status/agents` | `getAgents()` | Список адресов агентов из конфигурации |
| GET | `/api/status/last-block` | `getLastBlock()` | Номер последнего обработанного блока. Query: `?chain=` (по умолчанию `polkadot_robonomics`) |

## Sensor Controller (V1)

**Файл:** `src/api/sensor/sensor.controller.ts`
**Префикс:** `sensor`

| Метод | Путь | Хендлер | Описание |
|-------|------|---------|----------|
| GET | `/api/sensor/cities` | `getCities()` | Список городов, сгруппированных по странам и регионам |
| GET | `/api/sensor/json` | `getSensorJson()` | Данные сенсоров из GPS-области или города за период. Query: `?start=&end=` (обязательные) + `&bound=lat1,lng1\|lat2,lng2` или `&city=`. Guard: `DateRangeGuard` |
| GET | `/api/sensor/csv/:start/:end/:city` | `getSensorCsv()` | CSV-файл (TSV) с данными сенсоров города за период. Заголовки: timestamp, sensor_id, geo, pm10, pm25, + динамические. Guard: `DateRangeGuard` |
| GET | `/api/sensor/measurements/:start/:end` | `getMeasurementTypes()` | Уникальные типы измерений за период (unix timestamps). Guard: `DateRangeGuard` |
| GET | `/api/sensor/messages/:start/:end` | `getMessages()` | Сообщения (model=MESSAGE) за период. Возвращает id, message, author, images, geo. Guard: `DateRangeGuard` |
| GET | `/api/sensor/:sensor/:start/:end` | `getSensorData()` | Данные сенсора за период (unix timestamps). Guard: `DateRangeGuard` |

## Sensor Controller (V2)

**Файл:** `src/api/sensor/sensor-v2.controller.ts`
**Префикс:** `v2/sensor`

| Метод | Путь | Хендлер | Описание |
|-------|------|---------|----------|
| GET | `/api/v2/sensor/maxdata/:type/:start/:end` | `getMaxData()` | Максимальные значения измерений указанного типа по каждому сенсору за период. Валидация `:type` — `/^[a-z0-9_]+$/`. Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/list/:start/:end` | `getSensorList()` | Список сенсоров с данными за указанный период. Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/urban/:start/:end` | `getUrbanSensorList()` | Список сенсоров без измерений `co2` за период (как `list`, но с фильтрацией). Guard: `DateRangeGuard` |
| GET | `/api/v2/sensor/:sensor/:start/:end` | `getSensorDataWithOwner()` | Данные сенсора за период + данные всех сенсоров того же owner. Ответ: `{ result, sensor: { owner, sensors, data } }`. Guard: `DateRangeGuard` |

## Story Controller (V2)

**Файл:** `src/api/story/story.controller.ts`
**Префикс:** `v2/story`

| Метод | Путь | Хендлер | Описание |
|-------|------|---------|----------|
| GET | `/api/v2/story/list` | `getList()` | Страница историй (сортировка по timestamp desc). Query: `?limit=` (max 50, default 50), `?page=` (default 1), `?start=`, `?end=` — все опциональные. Ответ: `{ totalPages, list }` |
| GET | `/api/v2/story/last/:sensor_id` | `getLast()` | Последняя история для указанного сенсора. Ответ: `{ result: { author, message, date, timestamp, icon } }` или `{ result: null }` |

## Сводка

- **Всего эндпоинтов:** 14
- **Все методы:** только GET
- **Версионирование:** V2 реализовано отдельным контроллером с префиксом `v2/sensor`
- **Контроллеры с эндпоинтами** находятся в `StatusModule`, `SensorModule`, `StoryModule`
- Модули `RobonomicsModule`, `MeasurementModule`, `GeocodingModule` загружаются условно (`INDEXER_ENABLED`) и не содержат HTTP-контроллеров
