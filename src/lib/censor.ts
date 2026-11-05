import { getSettings } from './settings';

/**
 * Swear filter for text (chat, captions, transcript, polls). Applied where text is
 * shown, so each person decides for themselves (Settings > Meetings).
 * Live voice can't be filtered: recognition only knows a word after it was heard.
 */
const ROOTS = [
  'fuck',
  'shit',
  'bitch',
  'cunt',
  'dick',
  'cock',
  'pussy',
  'asshole',
  'arsehole',
  'bastard',
  'bollocks',
  'wanker',
  'twat',
  'prick',
  'slut',
  'whore',
  'motherfucker',
  'bullshit',
  'dickhead',
  'douche',
  'jackass',
  'damn',
  'crap',
  'piss',
];
// Whole words only (plus common endings), so "class", "assume" or "Scunthorpe" are safe.
const SUFFIX = '(?:s|es|ed|er|ers|ing|in|y|ty|head|face|hole|tard)?';
// Allow simple disguises: f*ck, sh1t, b!tch, a$$hole.
const letter = (ch: string) =>
  ({ a: '[a@4*]', i: '[i1!*|]', o: '[o0*]', e: '[e3*]', s: '[s$5*]', u: '[u*v]', c: '[ck]' })[ch] ?? ch;
const PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${ROOTS.map((w) => [...w].map(letter).join('')).join('|')})${SUFFIX}(?![\\p{L}\\p{N}])`,
  'giu',
);
const EXTRA = /(?<![\p{L}\p{N}])(?:ass|arse)(?![\p{L}\p{N}])/giu;

const mask = (w: string) => (w.length <= 2 ? '*'.repeat(w.length) : w[0] + '*'.repeat(w.length - 1));

export function censorText(text: string): string {
  return text.replace(PATTERN, mask).replace(EXTRA, mask);
}

/** Censor if the user has the filter on. */
export function censor(text: string): string {
  return getSettings().censorSwears ? censorText(text) : text;
}
