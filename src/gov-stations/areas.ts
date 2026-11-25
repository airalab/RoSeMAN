import { US_STATES } from './sources/iso-codes.js';
import type { GovSource } from './sources/types.js';

/**
 * An area is what a map visitor switches on in one go: a national network as a whole ("be-irceline"), or one
 * region of a network that spans several ("us-airnow:US-CA", "us-airnow:TH").
 */
export function areaId(source: string, region?: string): string {
  return region ? `${source}:${region}` : source;
}

const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });

function countryName(code: string): string {
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

/** "Belgium", "California, USA", "Thailand": the place a map prompt names. */
export function areaName(source: GovSource, area: string): string {
  const region = area.includes(':') ? area.slice(area.indexOf(':') + 1) : '';
  if (!region) {
    return /^[A-Z]{2}$/.test(source.country)
      ? countryName(source.country)
      : source.network;
  }
  if (region.startsWith('US-') && US_STATES[region.slice(3)]) {
    return `${US_STATES[region.slice(3)]}, USA`;
  }
  return region === 'US' ? 'United States' : countryName(region);
}
