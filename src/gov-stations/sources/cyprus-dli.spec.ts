import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cyprusEpoch, parseDliPage } from './cyprus-dli.js';

const page = readFileSync(
  join(__dirname, '..', '__fixtures__', 'dli-2026-11-24.html'),
  'utf8',
);

describe('Cyprus DLI page', () => {
  const byId = new Map(parseDliPage(page).map((r) => [r.station_id, r]));

  it('reads the Nicosia traffic station with PM, gases and the hour', () => {
    const r = byId.get('cy-dli-nictra');
    expect(r?.values).toEqual({
      pm10: 28.6,
      pm25: 10.8,
      o3: 67.6,
      no: 7.8,
      no2: 23.6,
      nox: 35.6,
      so2: 4.1,
      co: 274.6,
      c6h6: 0.6,
    });
    expect(r?.timestamp).toBe(cyprusEpoch(2026, 11, 24, 13, 0));
  });

  it('does not give the residential station the PM of the traffic block that follows it', () => {
    const r = byId.get('cy-dli-nicres');
    expect(r?.values.pm10).toBeUndefined();
    expect(r?.values.pm25).toBeUndefined();
    expect(r?.values.no2).toBe(20.1);
  });

  it('reads the rural background station', () => {
    expect(byId.get('cy-dli-agmbac')?.values.pm25).toBe(3.9);
  });

  it('skips stations without a known position (Mari)', () => {
    expect([...byId.keys()].some((id) => id.includes('mar'))).toBe(false);
  });

  it('Cyprus time follows EET/EEST', () => {
    expect(cyprusEpoch(2026, 11, 24, 13, 0)).toBe(
      Date.UTC(2026, 10, 24, 11, 0) / 1000,
    );
    expect(cyprusEpoch(2026, 7, 1, 13, 0)).toBe(
      Date.UTC(2026, 6, 1, 10, 0) / 1000,
    );
  });
});
