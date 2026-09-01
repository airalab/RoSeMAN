import { parseCpsBackfillOptions } from './cps-backfill.options.js';

describe('parseCpsBackfillOptions', () => {
  it('разбирает dry-run, диапазон, CID, limit и force', () => {
    expect(
      parseCpsBackfillOptions([
        '--dry-run',
        '--start-block=10',
        '--end-block',
        '20',
        '--cid',
        'QmTest',
        '--limit=25',
        '--force',
      ]),
    ).toEqual({
      dryRun: true,
      startBlock: 10,
      endBlock: 20,
      cid: 'QmTest',
      limit: 25,
      includeCompleted: true,
    });
  });

  it('использует безопасный limit по умолчанию', () => {
    expect(parseCpsBackfillOptions([])).toEqual({
      dryRun: false,
      limit: 100,
    });
  });

  it('отклоняет неизвестный аргумент и обратный диапазон', () => {
    expect(() => parseCpsBackfillOptions(['--unknown'])).toThrow(
      'Unknown CPS backfill argument',
    );
    expect(() =>
      parseCpsBackfillOptions(['--start-block=20', '--end-block=10']),
    ).toThrow('--start-block must not exceed --end-block');
  });
});
