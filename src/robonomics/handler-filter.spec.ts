import { Logger } from '@nestjs/common';
import { filterHandlers } from './handler-filter.js';

describe('filterHandlers', () => {
  const originalEnabled = process.env.ENABLED_HANDLERS;
  const originalDisabled = process.env.DISABLED_HANDLERS;

  afterEach(() => {
    if (originalEnabled === undefined) delete process.env.ENABLED_HANDLERS;
    else process.env.ENABLED_HANDLERS = originalEnabled;
    if (originalDisabled === undefined) delete process.env.DISABLED_HANDLERS;
    else process.env.DISABLED_HANDLERS = originalDisabled;
    jest.restoreAllMocks();
  });

  it('предупреждает только об активных legacy handlers', () => {
    process.env.ENABLED_HANDLERS = 'cps-payload-set,rws-story';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const handlers = filterHandlers(
      [{ name: 'cps-payload-set' }, { name: 'rws-story' }],
      'extrinsic',
    );

    expect(handlers).toEqual([
      { name: 'cps-payload-set' },
      { name: 'rws-story' },
    ]);
    expect(warn).toHaveBeenCalledWith(
      'Deprecated legacy extrinsic handlers are active: rws-story',
    );
  });

  it('не предупреждает, когда legacy handlers отфильтрованы', () => {
    process.env.ENABLED_HANDLERS = 'cps-payload-set';
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    const handlers = filterHandlers(
      [{ name: 'cps-payload-set' }, { name: 'datalog-new-record' }],
      'event',
    );

    expect(handlers).toEqual([{ name: 'cps-payload-set' }]);
    expect(warn).not.toHaveBeenCalled();
  });
});
