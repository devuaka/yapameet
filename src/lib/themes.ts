import type { EggId, ThemeId } from './settings';

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

export const EGGS: EggInfo[] = [
  {
    id: 'ghost',
    name: 'Ghost Protocol',
    hint: 'Some people never really leave a room. In a call, knock three times on the door.',
    found: 'Triple-click the logo in a call. Photograph your empty room, and when you leave you fade out of it for everyone.',
  },
  {
    id: 'konami',
    name: 'Old School',
    hint: 'Gamers of a certain age know the code.',
    found: 'The Konami code (up up down down left right left right B A). Confetti for everyone, plus the Arcade theme.',
  },
  {
    id: 'barrelroll',
    name: 'Barrel Roll',
    hint: 'Ask the chat to do what a certain fox pilot was always told.',
    found: 'Type "do a barrel roll" in chat. Everyone\'s screen spins.',
  },
  {
    id: 'bubblegum',
    name: 'Ticklish',
    hint: 'The logo on the home page is ticklish.',
    found: 'Click the logo on the home page five times. Unlocks the Bubblegum theme.',
  },
  {
    id: 'party',
    name: 'Party Mode',
    hint: 'Chat commands start with a slash. One of them is not in /help.',
    found: 'Type /party in chat. Disco lights and confetti for the whole call.',
  },
  {
    id: 'gaben',
    name: 'Lord Gaben',
    hint: 'Name your meeting after the man who cannot count to three.',
    found: 'Use the meeting code "gabenewel". Gabe Newell joins the call and thanks you every 36 seconds.',
  },
];
