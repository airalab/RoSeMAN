import { belgiumIrceline } from './belgium-irceline.js';
import { cyprusDli } from './cyprus-dli.js';
import { germanyUba } from './germany-uba.js';
import { netherlandsRivm } from './netherlands-rivm.js';
import { ukDefra } from './uk-defra.js';
import { usAirnow } from './us-airnow.js';
import type { GovSource } from './types.js';

/** Every known source; GOV_STATIONS_SOURCES narrows the list. Add a region here. */
export const GOV_SOURCES: GovSource[] = [
  cyprusDli,
  netherlandsRivm,
  belgiumIrceline,
  germanyUba,
  ukDefra,
  usAirnow,
];

export function selectSources(ids: string[]): GovSource[] {
  return ids.length
    ? GOV_SOURCES.filter((s) => ids.includes(s.id))
    : GOV_SOURCES;
}
