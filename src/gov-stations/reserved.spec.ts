import { isReservedGovId } from './reserved.js';

describe('government station ids are reserved', () => {
  it('matches every network prefix and nothing else', () => {
    expect(isReservedGovId('de-uba-21')).toBe(true);
    expect(isReservedGovId('nl-rivm-NL10742')).toBe(true);
    expect(isReservedGovId('cy-dli-nictra')).toBe(true);
    expect(
      isReservedGovId('4H1euDXpH5HRTXDXDqMv4w15nhyjsW1ZgGiqG51TZGzH36TF'),
    ).toBe(false);
    expect(isReservedGovId('de-ubaX')).toBe(false);
  });
});
