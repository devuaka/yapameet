import { useSyncExternalStore } from 'react';

export type ThemeId =
  | 'midnight'
  | 'nebula'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'synthwave'
  | 'mono'
  | 'amoled'
  | 'daylight'
  | 'arcade'
  | 'bubblegum';

export type VideoQuality = 'saver' | 'standard' | 'hd' | 'fullhd' | 'fullhd60';
export type CodecPref = 'auto' | 'vp8' | 'vp9' | 'h264' | 'av1';
export type BgEffect = 'none' | 'blur-light' | 'blur' | 'image';
export type FilterId =
  | 'none'
  | 'warm'
  | 'cool'
  | 'vivid'
  | 'bw'
  | 'noir'
  | 'vintage'
  | 'dream'
  | 'neon'
  | 'thermal'
  | 'invert'
  | 'pixel';
export type VoiceFx = 'none' | 'robot' | 'chipmunk' | 'deep' | 'alien' | 'radio' | 'megaphone' | 'cave';
export type LayoutPref = 'auto' | 'grid' | 'speaker';
export type EggId = 'ghost' | 'konami' | 'barrelroll' | 'bubblegum' | 'party';

export interface Settings {
  displayName: string;
  micId: string;
  camId: string;
  speakerId: string;
  joinMuted: boolean;
  joinCameraOff: boolean;
  mirrorSelf: boolean;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  sounds: boolean;
  soundVolume: number;
  showConnectionDetails: boolean;
  // appearance
  theme: ThemeId;
  reduceMotion: boolean;
  showClock: boolean;
  compactTiles: boolean;
  // video
  videoQuality: VideoQuality;
  codec: CodecPref;
  lowLatency: boolean;
  bgEffect: BgEffect;
  bgImage: string;
  filter: FilterId;
  lowLightBoost: boolean;
  // meeting
  layout: LayoutPref;
  hideSelfView: boolean;
  pushToTalk: boolean;
  mutedWarning: boolean;
  reactionsFloat: boolean;
  soundboardVolume: number;
  autoMiniPlayer: boolean;
  shareCaptions: boolean;
  captionsLang: string;
  voiceFx: VoiceFx;
  autoFrame: boolean;
  sticker: import('../rtc/faceStickers').StickerId;
  censorSwears: boolean;
  // secrets
  eggs: EggId[];
}

const KEY = 'yapameet:settings:v1';

export const defaultSettings: Settings = {
  displayName: '',
  micId: '',
  camId: '',
  speakerId: '',
  joinMuted: false,
  joinCameraOff: false,
  mirrorSelf: true,
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  sounds: true,
  soundVolume: 0.8,
  showConnectionDetails: false,
  theme: 'midnight',
  reduceMotion: false,
  showClock: true,
  compactTiles: false,
  videoQuality: 'hd',
  codec: 'auto',
  lowLatency: true,
  bgEffect: 'none',
  bgImage: 'preset:aurora',
  filter: 'none',
  lowLightBoost: false,
  layout: 'auto',
  hideSelfView: false,
  pushToTalk: true,
  mutedWarning: true,
  reactionsFloat: true,
  soundboardVolume: 0.8,
  autoMiniPlayer: true,
  shareCaptions: true,
  captionsLang: '',
  voiceFx: 'none',
  autoFrame: false,
  sticker: 'none',
  censorSwears: true,
  eggs: [],
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* private mode or corrupted: fall back to defaults */
  }
  return { ...defaultSettings };
}

let current = load();
const listeners = new Set<() => void>();

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* storage full / blocked: settings just won't persist */
  }
  for (const fn of listeners) fn();
}

export function resetSettings(): void {
  const keep = { displayName: current.displayName, eggs: current.eggs };
  updateSettings({ ...defaultSettings, ...keep });
}

/** Mark an easter egg as found. Returns true the first time. */
export function findEgg(id: EggId): boolean {
  if (current.eggs.includes(id)) return false;
  updateSettings({ eggs: [...current.eggs, id] });
  return true;
}

export const subscribeSettings = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

window.addEventListener('storage', (e) => {
  if (e.key === KEY) {
    current = load();
    for (const fn of listeners) fn();
  }
});

// Debug/test hook (harmless: same as using the settings UI).
(window as unknown as { __yapameetSettings?: unknown }).__yapameetSettings = { get: getSettings, update: updateSettings };

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings);
}

/** Stable per-tab id. Survives reloads, so peers can replace our stale connection instead of duplicating it. */
export function getClientId(): string {
  const k = 'yapameet:clientId';
  let id = sessionStorage.getItem(k);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem(k, id);
  }
  return id;
}

// ---------------------------------------------------------------- presets

export interface QualityPreset {
  label: string;
  width: number;
  height: number;
  fps: number;
  /** Max send bitrate to ONE peer in a 1:1 call. */
  maxBitrate: number;
}

export const QUALITY: Record<VideoQuality, QualityPreset> = {
  saver: { label: 'Data saver (360p)', width: 640, height: 360, fps: 24, maxBitrate: 500_000 },
  standard: { label: 'Standard (540p)', width: 960, height: 540, fps: 30, maxBitrate: 1_200_000 },
  hd: { label: 'HD (720p)', width: 1280, height: 720, fps: 30, maxBitrate: 2_500_000 },
  fullhd: { label: 'Full HD (1080p)', width: 1920, height: 1080, fps: 30, maxBitrate: 4_500_000 },
  fullhd60: { label: 'Full HD 60fps (1080p60)', width: 1920, height: 1080, fps: 60, maxBitrate: 7_000_000 },
};
