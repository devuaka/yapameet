import { useSyncExternalStore } from 'react';

/**
 * Profile picture: a small square JPEG/PNG data URL kept in this browser and
 * shared peer-to-peer with everyone in the call (never uploaded anywhere).
 */
const KEY = 'yapameet:pfp:v1';
export const PFP_SIZE = 192;
const MAX_LEN = 120_000;

let current: string | null = (() => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
})();
const listeners = new Set<() => void>();

export function getPfp(): string | null {
  return current;
}

export function setPfp(url: string | null) {
  current = url && isValidPfp(url) ? url : null;
  try {
    if (current) localStorage.setItem(KEY, current);
    else localStorage.removeItem(KEY);
  } catch {
    /* storage full: keeps working for this session */
  }
  listeners.forEach((f) => f());
}

export const subscribePfp = (f: () => void) => {
  listeners.add(f);
  return () => {
    listeners.delete(f);
  };
};

export function usePfp(): string | null {
  return useSyncExternalStore(subscribePfp, getPfp);
}

/** Only accept small inline images (what we generate). Anything else from a peer is dropped. */
export function isValidPfp(url: unknown): url is string {
  return typeof url === 'string' && url.length < MAX_LEN && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url);
}

function squareCanvas() {
  const c = document.createElement('canvas');
  c.width = c.height = PFP_SIZE;
  return c;
}

/** Center-crop any image source to a square and encode it small. */
function encode(src: CanvasImageSource, w: number, h: number, mirror = false): string {
  const c = squareCanvas();
  const g = c.getContext('2d')!;
  const side = Math.min(w, h);
  if (mirror) {
    g.translate(PFP_SIZE, 0);
    g.scale(-1, 1);
  }
  g.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, PFP_SIZE, PFP_SIZE);
  return c.toDataURL('image/jpeg', 0.85);
}

export async function pfpFromFile(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Pick an image file (JPG, PNG, GIF, WebP).');
  if (file.size > 15 * 1024 * 1024) throw new Error('That image is too big (max 15 MB).');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error("Couldn't read that image.");
  }
  const url = encode(bmp, bmp.width, bmp.height);
  bmp.close();
  return url;
}

/** Snapshot from a live camera track. */
export async function pfpFromTrack(track: MediaStreamTrack, mirror: boolean): Promise<string | null> {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.srcObject = new MediaStream([track]);
  try {
    await v.play();
    if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
    await new Promise((r) => setTimeout(r, 150));
    return encode(v, v.videoWidth, v.videoHeight, mirror);
  } catch {
    return null;
  } finally {
    v.srcObject = null;
  }
}

export const PFP_EMOJIS = ['😎', '🐸', '🐱', '🐶', '🦊', '🐼', '🐵', '🦄', '👻', '🤖', '👽', '🐙', '🍕', '🌮', '🔥', '⭐', '🌈', '🎮', '🎧', '🚀', '💀', '🤠', '🥶', '🫠'];
export const PFP_COLORS = [
  ['#8b5cf6', '#3b82f6'],
  ['#ec4899', '#8b5cf6'],
  ['#f97316', '#ec4899'],
  ['#22c55e', '#14b8a6'],
  ['#06b6d4', '#3b82f6'],
  ['#facc15', '#f97316'],
  ['#64748b', '#1e293b'],
  ['#f43f5e', '#7c3aed'],
];

/** Emoji on a gradient circle background, rendered to a PNG. */
export function pfpFromEmoji(emoji: string, colors: string[]): string {
  const c = squareCanvas();
  const g = c.getContext('2d')!;
  const gr = g.createLinearGradient(0, 0, PFP_SIZE, PFP_SIZE);
  gr.addColorStop(0, colors[0]);
  gr.addColorStop(1, colors[1]);
  g.fillStyle = gr;
  g.fillRect(0, 0, PFP_SIZE, PFP_SIZE);
  g.font = `${PFP_SIZE * 0.56}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, PFP_SIZE / 2, PFP_SIZE * 0.54);
  return c.toDataURL('image/jpeg', 0.9);
}
