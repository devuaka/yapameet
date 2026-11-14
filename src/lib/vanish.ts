import { useEffect, useState } from 'react';

/**
 * Secret toy "Lightning Vanish" (unlocked by typing omar123.exe in the chat).
 * You photograph your empty room, step back in, get struck by lightning and
 * vanish: everyone sees only your empty room for 15 seconds, then you fade back.
 * Times are milliseconds from the strike.
 */
export const STRIKE_MS = 700; // bolt + flash while you are still visible
export const GONE_MS = 15_000; // only the empty room is shown
export const BACK_MS = 800; // the room photo fades away and you are back
export const VANISH_TOTAL_MS = STRIKE_MS + GONE_MS + BACK_MS;

export const VANISH_CODE = /^omar123\.exe$/i;

export interface Vanish {
  photo: string;
  at: number;
}

export type VanishPhase = 'strike' | 'gone' | 'back' | null;

export function vanishPhase(at: number | undefined, now = Date.now()): VanishPhase {
  if (!at) return null;
  const dt = now - at;
  if (dt < 0 || dt >= VANISH_TOTAL_MS) return null;
  return dt < STRIKE_MS ? 'strike' : dt < STRIKE_MS + GONE_MS ? 'gone' : 'back';
}

/** Re-renders at each phase change of a strike that started at `at`. */
export function useVanishPhase(at: number | undefined): VanishPhase {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const marks = [STRIKE_MS, STRIKE_MS + GONE_MS, VANISH_TOTAL_MS];
    const timers = marks.map((ms) => window.setTimeout(() => tick((n) => n + 1), Math.max(0, at + ms - Date.now())));
    return () => timers.forEach(clearTimeout);
  }, [at]);
  return vanishPhase(at);
}

/** Only accept a reasonably sized image data URL from peers. */
export const isRoomPhoto = (d: unknown): d is string => typeof d === 'string' && d.startsWith('data:image/') && d.length < 600_000;
