import type { EggId, ThemeId } from './settings';
import { TOYS } from './toys';

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  colors: [bg: string, accent: string, accent2: string];
  secret?: EggId;
}

export const THEMES: ThemeInfo[] = [
  { id: 'midnight', label: 'Midnight', colors: ['#0b0c15', '#8b5cf6', '#3b82f6'] },
  { id: 'nebula', label: 'Nebula', colors: ['#0f0a1a', '#ec4899', '#8b5cf6'] },
  { id: 'ocean', label: 'Ocean', colors: ['#04121a', '#06b6d4', '#3b82f6'] },
  { id: 'sunset', label: 'Sunset', colors: ['#160b0c', '#f97316', '#ec4899'] },
  { id: 'forest', label: 'Forest', colors: ['#07120c', '#22c55e', '#14b8a6'] },
  { id: 'synthwave', label: 'Synthwave', colors: ['#0d0221', '#ff2a6d', '#05d9e8'] },
  { id: 'mono', label: 'Mono', colors: ['#0c0c0d', '#e4e4e7', '#a1a1aa'] },
  { id: 'amoled', label: 'AMOLED black', colors: ['#000000', '#8b5cf6', '#3b82f6'] },
  { id: 'daylight', label: 'Daylight', colors: ['#f4f5fb', '#6d5df6', '#3b82f6'] },
  { id: 'arcade', label: 'Arcade', colors: ['#050505', '#39ff14', '#00e5ff'], secret: 'konami' },
  { id: 'bubblegum', label: 'Bubblegum', colors: ['#1a0b18', '#ff6ad5', '#ffb86c'], secret: 'bubblegum' },
];

export interface EggInfo {
  id: EggId;
  name: string;
  hint: string;
  found: string;
}

/** Hints are what you see before finding a secret: keep them vague. */
export const EGGS: EggInfo[] = [
  {
    id: 'ghost',
    name: 'Ghost Protocol',
    hint: 'Knock, knock, knock.',
    found: 'Triple-click the logo in a call. Photograph your empty room, and when you leave you fade out of it for everyone.',
  },
  {
    id: 'konami',
    name: 'Old School',
    hint: 'Thirty extra lives, if you remember how.',
    found: 'The Konami code (up up down down left right left right B A). Confetti for everyone, plus the Arcade theme.',
  },
  {
    id: 'barrelroll',
    name: 'Barrel Roll',
    hint: 'A fox once gave some advice.',
    found: 'Type "do a barrel roll" in chat. Everyone\'s screen spins.',
  },
  {
    id: 'bubblegum',
    name: 'Ticklish',
    hint: 'Someone on the home page is ticklish.',
    found: 'Click the logo on the home page five times. Unlocks the Bubblegum theme.',
  },
  {
    id: 'party',
    name: 'Party Mode',
    hint: 'Not every slash command admits it exists.',
    found: 'Type /party in chat. Disco lights and confetti for the whole call.',
  },
  {
    id: 'gaben',
    name: 'Lord Gaben',
    hint: 'Some rooms are already taken by a legend.',
    found: 'Use the meeting code "gabenewel". Gabe Newell joins the call and says one of his lines every 36 seconds.',
  },
  ...TOYS.map((t) => ({ id: t.id, name: t.name, hint: t.hint, found: `Type ${t.word} in Activities > Games > Commands. ${t.found}` })),
];
