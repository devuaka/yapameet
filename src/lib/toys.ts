/**
 * Secret toys. Each one is unlocked by typing its word into Activities > Games > Commands,
 * then lives as a button under Games > Secrets.
 *  - toggle: on/off for everyone in the call (late joiners get pulled in too)
 *  - once:   fires once on everyone's screen
 *  - dialog: opens something just for you (Lightning Vanish)
 * Hints are shown in Settings > Secrets before you find them: keep them vague.
 */
export type ToyId =
  | 'omar'
  | 'evilflower'
  | 'chipparty'
  | 'snowday'
  | 'rainyday'
  | 'bighead'
  | 'deepfried'
  | 'earthquake'
  | 'matrix'
  | 'comicsans'
  | 'bananas'
  | 'australia'
  | 'dizzy'
  | 'honk'
  | 'gravity'
  | 'whoopee'
  | 'ralsei'
  | 'portablegabe'
  | 'bomboclat';

export interface ToyDef {
  id: ToyId;
  word: string;
  /** Other spellings that also work. */
  aliases?: string[];
  name: string;
  emoji: string;
  kind: 'toggle' | 'once' | 'dialog';
  hint: string;
  found: string;
}

export const TOYS: ToyDef[] = [
  {
    id: 'omar',
    word: 'lightning',
    name: 'Lightning Vanish',
    emoji: '⚡',
    kind: 'dialog',
    hint: 'What arrives just before the thunder?',
    found: 'Snap your empty room, get struck by lightning, and vanish for 15 seconds.',
  },
  {
    id: 'evilflower',
    word: 'evilflower',
    name: 'Evil Flower',
    emoji: '🌸',
    kind: 'toggle',
    hint: 'Not every flower is sweet.',
    found: "Everyone's screen turns red and the scream plays until someone pulls it up.",
  },
  {
    id: 'chipparty',
    word: 'chipparty',
    name: 'Chip Party',
    emoji: '🥔',
    kind: 'toggle',
    hint: 'Crunchy. Salty. Everywhere.',
    found: "Spinning crisps bounce around everyone's screen.",
  },
  {
    id: 'snowday',
    word: 'snowday',
    name: 'Snow Day',
    emoji: '❄️',
    kind: 'toggle',
    hint: 'School is cancelled.',
    found: 'Snow falls on everyone while the wind howls.',
  },
  {
    id: 'rainyday',
    word: 'rainyday',
    name: 'Stormy',
    emoji: '🌧️',
    kind: 'toggle',
    hint: 'The weather forecast was wrong again.',
    found: 'A downpour for everyone, sound included.',
  },
  {
    id: 'bighead',
    word: 'bighead',
    name: 'Big Head Mode',
    emoji: '🗿',
    kind: 'toggle',
    hint: 'An old cheat code for egos.',
    found: 'Everyone gets a very, very big head.',
  },
  {
    id: 'deepfried',
    word: 'deepfried',
    name: 'Deep Fried',
    emoji: '🍳',
    kind: 'toggle',
    hint: 'How the internet cooks its memes.',
    found: "Everyone's camera gets deep fried. You can hear it sizzle.",
  },
  {
    id: 'earthquake',
    word: 'earthquake',
    name: 'Earthquake',
    emoji: '🌋',
    kind: 'toggle',
    hint: 'The ground has opinions.',
    found: 'The whole call shakes and rumbles.',
  },
  {
    id: 'matrix',
    word: 'matrix',
    name: 'Wake Up',
    emoji: '💊',
    kind: 'toggle',
    hint: 'Red pill or blue pill?',
    found: 'Green code rains down and everyone turns digital.',
  },
  {
    id: 'comicsans',
    word: 'comicsans',
    name: 'Serious Business',
    emoji: '🖍️',
    kind: 'toggle',
    hint: "Every designer's worst nightmare.",
    found: 'Everything is written in the most professional font ever made.',
  },
  {
    id: 'bananas',
    word: 'bananas',
    name: 'Going Bananas',
    emoji: '🍌',
    kind: 'toggle',
    hint: 'What a monkey goes when it loses it.',
    found: "Bananas bounce around everyone's screen.",
  },
  {
    id: 'australia',
    word: 'australia',
    name: 'Down Under',
    emoji: '🦘',
    kind: 'toggle',
    hint: 'Somewhere, everyone is upside down.',
    found: 'All the video flips upside down.',
  },
  {
    id: 'dizzy',
    word: 'dizzy',
    name: 'Dizzy',
    emoji: '💫',
    kind: 'toggle',
    hint: 'Round and round and round.',
    found: 'Every video slowly spins.',
  },
  {
    id: 'honk',
    word: 'honk',
    name: 'Honk',
    emoji: '🤡',
    kind: 'once',
    hint: "A goose's favourite word.",
    found: 'A clown horn honks for everyone.',
  },
  {
    id: 'gravity',
    word: 'gravity',
    name: 'Gravity',
    emoji: '🍎',
    kind: 'once',
    hint: 'What goes up...',
    found: 'Every video falls off the screen, then climbs back.',
  },
  {
    id: 'whoopee',
    word: 'whoopee',
    name: 'Whoopee',
    emoji: '💨',
    kind: 'once',
    hint: 'A cushion with a sense of humour.',
    found: 'Everyone hears it. Everyone knows it was you.',
  },
  {
    id: 'ralsei',
    word: 'ralsei',
    aliases: ['ralsi'],
    name: 'Catch Ralsei',
    emoji: '🐐',
    kind: 'once',
    hint: 'A fluffy prince from a dark world wants to play tag.',
    found: 'He dances around everyone\'s screen. Whoever clicks him first blows him up.',
  },
  {
    id: 'portablegabe',
    word: 'portablegabe',
    name: 'Portable Gabe',
    emoji: '👑',
    kind: 'toggle',
    hint: 'A legend small enough to fit in your pocket.',
    found: 'Gabe Newell joins whatever call you are in.',
  },
  {
    id: 'bomboclat',
    word: 'bomboclat',
    name: 'Bomboclat',
    emoji: '🔊',
    kind: 'toggle',
    hint: 'When the phonk drops, so does the call.',
    found: 'The song plays, every part of the screen strobes a different colour and everything shakes.',
  },
];

export const findToyByWord = (text: string) => {
  const w = text.toLowerCase().replace(/\s+/g, '');
  return TOYS.find((t) => t.word === w || t.aliases?.includes(w)) ?? null;
};
