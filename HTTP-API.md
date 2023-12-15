HTTP API

number of last indexed block
http://localhost:3000/api/status/last-block

list of addresses for connectivity
http://localhost:3000/api/status/agents

list of cities
https://localhost:3000/api/sensor/cities

latest data for each sensor for period
https://localhost:3000/api/sensor/last/TIMESTAMP_START/TIMESTAMP_END
example
https://localhost:3000/api/sensor/last/1702584000/1702670399

complaints for period
https://localhost:3000/api/sensor/messages/TIMESTAMP_START/TIMESTAMP_END
example
https://localhost:3000/api/sensor/messages/1702584000/1702670399

maximum readings for each sensor for period for selected indicator
https://localhost:3000/api/sensor/max/TIMESTAMP_START/TIMESTAMP_END/MEASURE
example
https://localhost:3000/api/sensor/max/1702497600/1702583999/pm10

sensor data for period
https://localhost:3000/api/sensor/SENSOR_ID/TIMESTAMP_START/TIMESTAMP_END
example
https://localhost:3000/api/sensor/7c499116a58e2321efceb71f5f2d6005e06e6b83d8cc2dae40dda07fb283975e/1702497600/1702583999

uploading data to csv
https://localhost:3000/api/sensor/csv/TIMESTAMP_START/TIMESTAMP_END/CITY_NAME
example
https://localhost:3000/api/sensor/csv/1702497600/1702670399/Baumgartenberg
