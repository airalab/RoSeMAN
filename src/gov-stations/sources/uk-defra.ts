import { type SosNetwork, sosSource } from './sos-52n.js';

/**
 * United Kingdom — DEFRA UK-AIR, the Automatic Urban and Rural Network (AURN) and affiliated sites:
 * https://uk-air.defra.gov.uk/ — SOS REST API https://uk-air.defra.gov.uk/sos-ukair/api/v1
 */
export const UK_AIR: SosNetwork = {
  id: 'uk-defra',
  api: 'https://uk-air.defra.gov.uk/sos-ukair/api/v1',
  latFirst: true,
  /** "Toft Newton-Particulate matter less than 2.5 micro m (aerosol)" → "Toft Newton" */
  nameOf: (label) => label.replace(/-[^-]*$/, '').trim() || label,
};

export const ukDefra = sosSource(UK_AIR, {
  network: 'UK-AIR, DEFRA',
  publisher:
    'DEFRA UK-AIR, the UK Department for Environment, Food & Rural Affairs',
  url: 'https://uk-air.defra.gov.uk/',
  country: 'GB',
});
