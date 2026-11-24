import { IRCELINE } from './belgium-irceline.js';
import { type SosSeries, sosReadings, sosStations } from './sos-52n.js';
import { UK_AIR } from './uk-defra.js';
import { cetEpoch, ubaReadings, ubaStations } from './germany-uba.js';
import { rivmReadings } from './netherlands-rivm.js';

describe('Netherlands RIVM', () => {
  it('merges pollutants of one station and hour, skips unknown stations', () => {
    const rows = [
      {
        station_number: 'NL10742',
        value: 11.71,
        timestamp_measured: '2026-11-24T13:00:00+00:00',
        formula: 'PM25',
      },
      {
        station_number: 'NL10742',
        value: 18.2,
        timestamp_measured: '2026-11-24T13:00:00+00:00',
        formula: 'PM10',
      },
      {
        station_number: 'NL10742',
        value: 3,
        timestamp_measured: '2026-11-24T13:00:00+00:00',
        formula: 'NO',
      },
      {
        station_number: 'NL99999',
        value: 9,
        timestamp_measured: '2026-11-24T13:00:00+00:00',
        formula: 'PM25',
      },
    ];
    expect(rivmReadings(rows, new Set(['nl-rivm-NL10742']))).toEqual([
      {
        station_id: 'nl-rivm-NL10742',
        timestamp: Date.UTC(2026, 10, 24, 13) / 1000,
        values: { pm25: 11.71, pm10: 18.2 },
      },
    ]);
  });
});

describe('Belgium IRCEL-CELINE', () => {
  const station = (id: number, label: string) => ({
    properties: { id, label },
    geometry: {
      coordinates: [4.385, 51.236, 'NaN'] as [number, number, string],
    },
  });
  const now = Date.UTC(2026, 10, 24, 13, 50) / 1000;
  const fresh = Date.UTC(2026, 10, 24, 13);

  it('names a station by its place and keeps one entry per station', () => {
    const s = station(1030, '40AL01 - Linkeroever');
    expect(
      sosStations(IRCELINE, [{ station: s }, { station: s }] as SosSeries[]),
    ).toEqual([
      {
        id: 'be-irceline-1030',
        name: 'Linkeroever',
        kind: 'station',
        lat: 51.236,
        lng: 4.385,
      },
    ]);
  });

  it('takes the last value of each pollutant, converts mg/m³, drops stale and negative ones', () => {
    const r = sosReadings(
      IRCELINE,
      {
        '6001': [
          {
            uom: 'µg/m³',
            lastValue: { timestamp: fresh, value: 13.384 },
            station: station(1070, '44RL01 - Roeselare'),
          },
        ],
        '10': [
          {
            uom: 'mg/m³',
            lastValue: { timestamp: fresh, value: 0.21 },
            station: station(1070, '44RL01 - Roeselare'),
          },
        ],
        '5': [
          {
            uom: 'µg/m³',
            lastValue: { timestamp: fresh - 8 * 3600_000, value: 20 },
            station: station(1070, '44RL01 - Roeselare'),
          },
          {
            uom: 'µg/m³',
            lastValue: { timestamp: fresh, value: -1 },
            station: station(1071, '44X - Y'),
          },
        ],
      },
      now,
    );
    expect(r).toEqual([
      {
        station_id: 'be-irceline-1070',
        timestamp: fresh / 1000,
        values: { pm25: 13.38, co: 210 },
      },
    ]);
  });
});

describe('UK DEFRA UK-AIR', () => {
  it('names a station by the label before the pollutant, reads [lat, lng]', () => {
    const series = [
      {
        station: {
          properties: {
            id: 788035,
            label:
              'Toft Newton-Particulate matter less than 2.5 micro m (aerosol)',
          },
          geometry: { coordinates: [53.3741, -0.4498, 'NaN'] },
        },
      },
      {
        station: {
          properties: {
            id: 1,
            label: 'Stoke-on-Trent Centre-Nitrogen dioxide (air)',
          },
          geometry: { coordinates: [53.02, -2.17, 'NaN'] },
        },
      },
      { station: { properties: { id: 2, label: 'Nowhere-Ozone' } } },
    ] as SosSeries[];
    expect(
      sosStations(UK_AIR, series).map((s) => [s.id, s.name, s.lat, s.lng]),
    ).toEqual([
      ['uk-defra-788035', 'Toft Newton', 53.3741, -0.4498],
      ['uk-defra-1', 'Stoke-on-Trent Centre', 53.02, -2.17],
    ]);
  });
});

describe('Germany UBA', () => {
  it('keeps active stations only', () => {
    const doc = {
      indices: [
        'station id',
        'station code',
        'station name',
        'station city',
        'station synonym',
        'station active from',
        'station active to',
        'station longitude',
        'station latitude',
        'network id',
        'station setting id',
        'station type id',
        'network code',
        'network name',
        'station setting name',
        'station setting short name',
        'station type name',
      ],
      data: {
        '3': [
          '3',
          'DEBB003',
          'Brandenburg, Gertrud-Pieter-Platz',
          'Brandenburg',
          'BRPI',
          '1991-03-01',
          '2001-06-07',
          '12.5444',
          '52.4121',
          '4',
          '1',
          '3',
          'BB',
          'Brandenburg',
          'urban area',
          'urban',
          'traffic',
        ],
        '21': [
          '21',
          'DEBE010',
          'Berlin Wedding',
          'Berlin',
          'X',
          '1990-01-01',
          '',
          '13.349',
          '52.543',
          '1',
          '1',
          '1',
          'BE',
          'Berlin',
          'urban area',
          'urban',
          'background',
        ],
      },
    };
    expect(ubaStations(doc)).toEqual([
      {
        id: 'de-uba-21',
        name: 'Berlin Wedding',
        kind: 'background',
        lat: 52.543,
        lng: 13.349,
      },
    ]);
  });

  it('reads CET hour ends and merges pollutants', () => {
    expect(cetEpoch('2026-11-24 14:00:00')).toBe(
      Date.UTC(2026, 10, 24, 13) / 1000,
    );
    const r = ubaReadings({
      '9': {
        data: {
          '21': {
            '2026-11-24 13:00:00': [9, 2, 6, '2026-11-24 14:00:00', '2'],
          },
        },
      },
      '5': {
        data: {
          '21': {
            '2026-11-24 13:00:00': [5, 2, 11, '2026-11-24 14:00:00', '0'],
            '2026-11-24 12:00:00': [5, 2, null, '2026-11-24 13:00:00', '0'],
          },
        },
      },
    });
    expect(r).toEqual([
      {
        station_id: 'de-uba-21',
        timestamp: Date.UTC(2026, 10, 24, 13) / 1000,
        values: { pm25: 6, no2: 11 },
      },
    ]);
  });
});
