import { airnowReadings, airnowStations, hourlyFiles } from './us-airnow.js';

const LOCATIONS = [
  'StationID|AQSID|FullAQSID|Parameter|MonitorType|SiteCode|SiteName|Status|AgencyID|AgencyName|EPARegion|Latitude|Longitude|Elevation|GMTOffset|CountryFIPS|CBSA_ID',
  '1|060371103|840060371103|PM2.5|Permanent|1103|LOS ANGELES-N. MAIN|Active|CA1|South Coast AQMD|R9|34.066429|-118.226755|87|-8|US|31080',
  '1|060371103|840060371103|OZONE|Permanent|1103|LOS ANGELES-N. MAIN|Active|CA1|South Coast AQMD|R9|34.066429|-118.226755|87|-8|US|31080',
  '2|000050314|124000050314|PM2.5|Permanent|0314|Québec - Charlesbour|Active|QC1|Canada-Quebec1|CA|46.86|-71.27||-5|CA|',
  '3|060370002|840060370002|OZONE|Permanent|0002|AZUSA|Active|CA1|South Coast AQMD|R9|34.13|-117.92||-8|US|',
  '4|000000000|586000000000|PM2.5|Permanent|0000|Islamabad-Old|Inactive|PK1|U.S. Department of State Pakistan|DSPK|33.72|73.11||5|PK|',
].join('\n');

describe('AirNow', () => {
  it('keeps active sites that measure dust, one station per site', () => {
    expect(airnowStations(LOCATIONS)).toEqual([
      {
        id: 'us-airnow-840060371103',
        name: 'Los Angeles-N. Main',
        kind: 'station',
        lat: 34.066429,
        lng: -118.226755,
        operator: 'South Coast AQMD',
      },
      {
        id: 'us-airnow-124000050314',
        name: 'Québec - Charlesbour',
        kind: 'station',
        lat: 46.86,
        lng: -71.27,
        operator: 'Canada-Quebec1',
      },
    ]);
  });

  it('matches 9- and 12-digit site ids, ends the hour, keeps ppb, skips negatives', () => {
    const known = new Set(['us-airnow-840060371103', 'us-airnow-124000050314']);
    const hour = [
      '11/24/26|14:00|060371103|LOS ANGELES-N. MAIN|-8|PM2.5|UG/M3|12.4|South Coast AQMD',
      '11/24/26|14:00|060371103|LOS ANGELES-N. MAIN|-8|OZONE|PPB|31|South Coast AQMD',
      '11/24/26|14:00|060371103|LOS ANGELES-N. MAIN|-8|TEMP|C|18|South Coast AQMD',
      '11/24/26|14:00|124000050314|Québec - Charlesbour|-5|PM2.5|UG/M3|-1.2|Canada-Quebec1',
      '11/24/26|14:00|124000050314|Québec - Charlesbour|-5|NO2|PPB|4.1|Canada-Quebec1',
      '11/24/26|14:00|999999999|Elsewhere|-5|PM2.5|UG/M3|7|Nobody',
    ].join('\n');
    expect(airnowReadings(hour, known)).toEqual([
      {
        station_id: 'us-airnow-840060371103',
        timestamp: Date.UTC(2026, 10, 24, 15) / 1000,
        values: { pm25: 12.4, o3: 31 },
      },
      {
        station_id: 'us-airnow-124000050314',
        timestamp: Date.UTC(2026, 10, 24, 15) / 1000,
        values: { no2: 4.1 },
      },
    ]);
  });

  it('skips an AQSID that two known stations share', () => {
    const known = new Set(['us-airnow-840000000001', 'us-airnow-124000000001']);
    const row = '11/24/26|14:00|000000001|X|0|PM2.5|UG/M3|5|Y';
    expect(airnowReadings(row, known)).toEqual([]);
  });

  it('asks for the last three finished UTC hours', () => {
    expect(hourlyFiles(Date.UTC(2026, 10, 25, 1, 20))).toEqual([
      'HourlyData_2026112500.dat',
      'HourlyData_2026112423.dat',
      'HourlyData_2026112422.dat',
    ]);
  });
});
