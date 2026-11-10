/**
 * Soundboard library: built-ins are real recordings in public/sfx (Mixkit free
 * license); uploads (MP3/WAV/OGG/M4A) are stored in IndexedDB on this device.
 */
import { loadSfx } from './sounds';
export interface SoundItem {
  id: string;
  name: string;
  emoji: string;
  builtin: boolean;
}

interface StoredSound extends SoundItem {
  blob: Blob;
  createdAt: number;
}

export const MAX_SOUND_BYTES = 3 * 1024 * 1024;
export const MAX_SOUND_SECONDS = 30;

// ---------------------------------------------------------------- built-ins

/** Real recordings in public/sfx (Mixkit free license). maxSec trims long ones. */
const BUILTINS: (SoundItem & { file: string; maxSec?: number })[] = [
  { id: 'builtin:fanfare', name: 'Fanfare', emoji: '🎺', builtin: true, file: 'sb-fanfare' },
  { id: 'builtin:badumtss', name: 'Ba-dum-tss', emoji: '🥁', builtin: true, file: 'sb-badumtss' },
  { id: 'builtin:sad', name: 'Sad trombone', emoji: '😢', builtin: true, file: 'sb-sadtrombone' },
  { id: 'builtin:partyhorn', name: 'Party horn', emoji: '🎉', builtin: true, file: 'sb-partyhorn' },
  { id: 'builtin:crickets', name: 'Crickets', emoji: '🦗', builtin: true, file: 'sb-crickets', maxSec: 4 },
  { id: 'builtin:boing', name: 'Boing', emoji: '🤸', builtin: true, file: 'sb-boing' },
  { id: 'builtin:applause', name: 'Applause', emoji: '👏', builtin: true, file: 'sb-applause' },
  { id: 'builtin:laugh', name: 'Laugh track', emoji: '😂', builtin: true, file: 'sb-laugh' },
  { id: 'builtin:drumroll', name: 'Drum roll', emoji: '🪘', builtin: true, file: 'sb-drumroll' },
  { id: 'builtin:clownhorn', name: 'Clown horn', emoji: '🤡', builtin: true, file: 'sb-clownhorn' },
  { id: 'builtin:kiss', name: 'Kiss', emoji: '😘', builtin: true, file: 'sb-kiss' },
  { id: 'builtin:gameover', name: 'Game over', emoji: '👾', builtin: true, file: 'sb-gameover' },
];

export const BUILTIN_SOUNDS: SoundItem[] = BUILTINS.map(({ id, name, emoji, builtin }) => ({ id, name, emoji, builtin }));

// ---------------------------------------------------------------- storage

let dbPromise: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('yapameet', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('sounds', { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction('sounds', mode).objectStore('sounds'));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function listCustomSounds(): Promise<SoundItem[]> {
  try {
    const all = (await tx<StoredSound[]>('readonly', (s) => s.getAll())) || [];
    return all.sort((a, b) => a.createdAt - b.createdAt).map(({ id, name, emoji }) => ({ id, name, emoji, builtin: false }));
  } catch {
    return [];
  }
}

const EMOJIS = ['🔊', '🎵', '💥', '🤣', '🐸', '🚨', '🎶', '👻', '🍕', '🦆'];

/** Validate and store an uploaded clip. Throws a user-readable Error if it's unusable. */
export async function addCustomSound(file: File, ctx: BaseAudioContext): Promise<SoundItem> {
  if (file.size > MAX_SOUND_BYTES) throw new Error(`That file is ${(file.size / 1048576).toFixed(1)} MB. Max is 3 MB.`);
  let buffer: AudioBuffer;
  try {
    buffer = await ctx.decodeAudioData(await file.arrayBuffer());
  } catch {
    throw new Error("Couldn't read that audio file. Try an MP3, WAV, OGG or M4A.");
  }
  if (buffer.duration > MAX_SOUND_SECONDS) throw new Error(`Clips can be up to ${MAX_SOUND_SECONDS} seconds (that one is ${Math.round(buffer.duration)}).`);
  const count = (await listCustomSounds()).length;
  const item: StoredSound = {
    id: `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: file.name.replace(/\.[^.]+$/, '').slice(0, 24) || 'Sound',
    emoji: EMOJIS[count % EMOJIS.length],
    builtin: false,
    blob: file,
    createdAt: Date.now(),
  };
  await tx('readwrite', (s) => s.put(item));
  buffers.set(item.id, Promise.resolve(buffer));
  return { id: item.id, name: item.name, emoji: item.emoji, builtin: false };
}

export async function renameCustomSound(id: string, name: string, emoji: string) {
  const item = await tx<StoredSound | undefined>('readonly', (s) => s.get(id));
  if (!item) return;
  await tx('readwrite', (s) => s.put({ ...item, name: name.slice(0, 24) || item.name, emoji: emoji || item.emoji }));
}

export async function removeCustomSound(id: string) {
  buffers.delete(id);
  await tx('readwrite', (s) => s.delete(id));
}

// ---------------------------------------------------------------- decoding

const buffers = new Map<string, Promise<AudioBuffer | null>>();

export function getSoundBuffer(id: string, ctx: BaseAudioContext): Promise<AudioBuffer | null> {
  let p = buffers.get(id);
  if (!p) {
    p = (async () => {
      const b = BUILTINS.find((x) => x.id === id);
      if (b) return loadSfx(b.file, b.maxSec ?? 0);
      const item = await tx<StoredSound | undefined>('readonly', (s) => s.get(id));
      if (!item) return null;
      return ctx.decodeAudioData(await item.blob.arrayBuffer());
    })().catch(() => null);
    buffers.set(id, p);
  }
  return p;
}
