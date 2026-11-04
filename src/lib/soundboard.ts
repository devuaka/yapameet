/**
 * Soundboard library: built-in sounds are synthesized (original, no samples to
 * license); uploads (MP3/WAV/OGG/M4A) are stored in IndexedDB on this device.
 */
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

type Synth = (ctx: OfflineAudioContext) => void;
const SR = 48000;

function noiseBuffer(ctx: BaseAudioContext, seconds: number) {
  const b = ctx.createBuffer(1, Math.ceil(seconds * ctx.sampleRate), ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function tone(ctx: BaseAudioContext, out: AudioNode, type: OscillatorType, freq: number, t: number, dur: number, vol: number, endFreq?: number) {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.01);
  g.gain.setValueAtTime(vol, t + dur * 0.7);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.02);
  return o;
}

function hit(ctx: BaseAudioContext, out: AudioNode, t: number, freq: number, vol: number) {
  tone(ctx, out, 'sine', freq, t, 0.22, vol, freq * 0.35);
}

function cymbal(ctx: BaseAudioContext, out: AudioNode, t: number, dur: number, vol: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx, dur);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 6000;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(hp).connect(g).connect(out);
  src.start(t);
}

const BUILTINS: (SoundItem & { secs: number; synth: Synth })[] = [
  {
    id: 'builtin:tada',
    name: 'Ta-da!',
    emoji: '🎺',
    builtin: true,
    secs: 1.6,
    synth(ctx) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 2800;
      lp.connect(ctx.destination);
      tone(ctx, lp, 'sawtooth', 523, 0, 0.14, 0.18);
      tone(ctx, lp, 'sawtooth', 659, 0.12, 0.14, 0.18);
      for (const f of [523, 659, 784, 1047]) tone(ctx, lp, 'sawtooth', f, 0.3, 1.2, 0.12);
      cymbal(ctx, ctx.destination, 0.3, 1.1, 0.15);
    },
  },
  {
    id: 'builtin:badumtss',
    name: 'Ba-dum-tss',
    emoji: '🥁',
    builtin: true,
    secs: 1.5,
    synth(ctx) {
      hit(ctx, ctx.destination, 0, 180, 0.9);
      hit(ctx, ctx.destination, 0.22, 140, 0.9);
      cymbal(ctx, ctx.destination, 0.46, 1.0, 0.35);
    },
  },
  {
    id: 'builtin:sad',
    name: 'Sad trombone',
    emoji: '😢',
    builtin: true,
    secs: 2.6,
    synth(ctx) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1400;
      lp.connect(ctx.destination);
      const notes: [number, number, number][] = [
        [294, 0, 0.45],
        [277, 0.5, 0.45],
        [262, 1.0, 0.45],
      ];
      for (const [f, t, d] of notes) tone(ctx, lp, 'sawtooth', f, t, d, 0.22);
      const o = tone(ctx, lp, 'sawtooth', 247, 1.5, 1.0, 0.22, 233);
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 6;
      lg.gain.value = 8;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(1.5);
      lfo.stop(2.55);
    },
  },
  {
    id: 'builtin:airhorn',
    name: 'Air horn',
    emoji: '📯',
    builtin: true,
    secs: 1.7,
    synth(ctx) {
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      for (const [t, d] of [
        [0, 0.28],
        [0.34, 0.28],
        [0.68, 0.9],
      ]) {
        for (const f of [466, 470, 932]) tone(ctx, comp, 'sawtooth', f, t, d, 0.12);
      }
    },
  },
  {
    id: 'builtin:crickets',
    name: 'Crickets',
    emoji: '🦗',
    builtin: true,
    secs: 3,
    synth(ctx) {
      for (let c = 0; c < 4; c++) {
        const t0 = c * 0.75 + 0.05;
        for (let i = 0; i < 3; i++) tone(ctx, ctx.destination, 'sine', 4600, t0 + i * 0.07, 0.05, 0.12);
      }
    },
  },
  {
    id: 'builtin:boing',
    name: 'Boing',
    emoji: '🤸',
    builtin: true,
    secs: 1,
    synth(ctx) {
      const o = tone(ctx, ctx.destination, 'triangle', 180, 0, 0.9, 0.4, 520);
      const lfo = ctx.createOscillator();
      const lg = ctx.createGain();
      lfo.frequency.value = 14;
      lg.gain.value = 60;
      lfo.connect(lg).connect(o.frequency);
      lfo.start(0);
      lfo.stop(0.9);
    },
  },
  {
    id: 'builtin:applause',
    name: 'Applause',
    emoji: '👏',
    builtin: true,
    secs: 3,
    synth(ctx) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      bp.Q.value = 0.6;
      bp.connect(ctx.destination);
      for (let i = 0; i < 160; i++) {
        const t = Math.random() * 2.6;
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 0.05);
        const g = ctx.createGain();
        const env = Math.min(1, t / 0.4) * Math.min(1, (3 - t) / 0.8);
        g.gain.setValueAtTime(0.5 * env * (0.4 + Math.random() * 0.6), t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
        src.connect(g).connect(bp);
        src.start(t);
      }
    },
  },
  {
    id: 'builtin:drumroll',
    name: 'Drum roll',
    emoji: '🪘',
    builtin: true,
    secs: 3,
    synth(ctx) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2500;
      bp.connect(ctx.destination);
      for (let t = 0; t < 2.2; t += 0.035) {
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer(ctx, 0.04);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.15 + (t / 2.2) * 0.45, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
        src.connect(g).connect(bp);
        src.start(t);
      }
      hit(ctx, ctx.destination, 2.25, 120, 1);
      cymbal(ctx, ctx.destination, 2.25, 0.75, 0.4);
    },
  },
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
      if (b) {
        const off = new OfflineAudioContext(1, Math.ceil(b.secs * SR), SR);
        b.synth(off);
        return off.startRendering();
      }
      const item = await tx<StoredSound | undefined>('readonly', (s) => s.get(id));
      if (!item) return null;
      return ctx.decodeAudioData(await item.blob.arrayBuffer());
    })().catch(() => null);
    buffers.set(id, p);
  }
  return p;
}
