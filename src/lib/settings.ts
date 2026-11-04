import { useSyncExternalStore } from 'react';

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
  showConnectionDetails: boolean;
}

const KEY = 'yapameet:settings:v1';

const defaults: Settings = {
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
  showConnectionDetails: false,
};

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch {
    /* private mode or corrupted: fall back to defaults */
  }
  return { ...defaults };
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

const subscribe = (fn: () => void) => {
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

export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
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
