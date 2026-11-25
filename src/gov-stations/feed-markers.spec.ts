import { feedMarkers } from './feed-markers.js';

const st = (id: string) => ({
  id,
  name: id.toUpperCase(),
  kind: 'station',
  lat: 50,
  lng: 4,
  source: 'be-irceline',
  area: 'be-irceline',
});

describe('feed markers', () => {
  it('takes the newest hour and the highest hour per quantity, in map units', () => {
    const markers = feedMarkers(
      { gasUnit: 'ugm3' },
      [st('a'), st('b')],
      [
        {
          source: 'be',
          station_id: 'a',
          timestamp: 3600,
          values: { pm25: 30, no2: 46.0055 },
        },
        {
          source: 'be',
          station_id: 'a',
          timestamp: 7200,
          values: { pm25: 12, so2: 5 },
        },
      ],
    );
    expect(markers).toEqual([
      {
        id: 'a',
        name: 'A',
        kind: 'station',
        lat: 50,
        lng: 4,
        timestamp: 7200,
        latest: { pm25: 12 },
        max: { pm25: 30, no2: 24.1 },
      },
    ]);
  });
});
