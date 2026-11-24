import { type SosNetwork, sosSource } from './sos-52n.js';

/**
 * Belgium — IRCEL-CELINE, the Belgian Interregional Environment Agency, for the networks of Flanders,
 * Wallonia and Brussels: https://www.irceline.be/ — SOS REST API https://geo.irceline.be/sos/api/v1
 */
export const IRCELINE: SosNetwork = {
  id: 'be-irceline',
  api: 'https://geo.irceline.be/sos/api/v1',
  /** "44RL01 - Roeselare" → "Roeselare" */
  nameOf: (label) => label.replace(/^[^-]+-\s*/, '').trim() || label,
};

export const belgiumIrceline = sosSource(IRCELINE, {
  network: 'IRCEL-CELINE, Belgium',
  publisher: 'IRCEL-CELINE, the Belgian Interregional Environment Agency',
  url: 'https://www.irceline.be/',
  country: 'BE',
});
