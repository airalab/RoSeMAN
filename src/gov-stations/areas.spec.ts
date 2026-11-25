import { areaId, areaName } from './areas.js';
import { GOV_SOURCES } from './sources/index.js';

const source = (id: string) => GOV_SOURCES.find((s) => s.id === id)!;

describe('feed areas', () => {
  it('a national network is one area, a spanning one is split by region', () => {
    expect(areaId('be-irceline')).toBe('be-irceline');
    expect(areaId('us-airnow', 'US-CA')).toBe('us-airnow:US-CA');
  });

  it('names the place for the map prompt', () => {
    expect(areaName(source('be-irceline'), 'be-irceline')).toBe('Belgium');
    expect(areaName(source('us-airnow'), 'us-airnow:US-CA')).toBe(
      'California, USA',
    );
    expect(areaName(source('us-airnow'), 'us-airnow:TH')).toBe('Thailand');
    expect(areaName(source('us-airnow'), 'us-airnow:US')).toBe('United States');
  });
});
