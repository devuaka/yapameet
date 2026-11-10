import { getSettings } from './settings';

/**
 * All sounds are real recordings (Mixkit free license, see README credits) in
 * public/sfx, decoded once and played through WebAudio so the speaker choice applies.
 */
let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

export const sfxUrl = (name: string) => `${import.meta.env.BASE_URL}sfx/${name}.mp3`;

const buffers = new Map<string, Promise<AudioBuffer | null>>();

/** Decode (once) a file from public/sfx. maxSec trims long recordings with a short fade. */
export function loadSfx(name: string, maxSec = 0): Promise<AudioBuffer | null> {
  const key = `${name}|${maxSec}`;
  let p = buffers.get(key);
  if (!p) {
    p = (async () => {
      try {
        const res = await fetch(sfxUrl(name));
        if (!res.ok) return null;
        const full = await getAudioContext().decodeAudioData(await res.arrayBuffer());
        if (!maxSec || full.duration <= maxSec) return full;
        const len = Math.floor(maxSec * full.sampleRate);
        const fade = Math.floor(0.25 * full.sampleRate);
        const cut = getAudioContext().createBuffer(full.numberOfChannels, len, full.sampleRate);
        for (let ch = 0; ch < full.numberOfChannels; ch++) {
          const src = full.getChannelData(ch).subarray(0, len);
          const dst = cut.getChannelData(ch);
          dst.set(src);
          for (let i = 0; i < fade; i++) dst[len - 1 - i] *= i / fade;
        }
        return cut;
      } catch {
        return null;
      }
    })();
    buffers.set(key, p);
  }
  return p;
}

function play(name: string, volume = 0.6, force = false) {
  const s = getSettings();
  if (!s.sounds && !force) return;
  const v = volume * (force ? 1 : s.soundVolume);
  if (v <= 0) return;
  void loadSfx(name).then((buf) => {
    if (!buf) return;
    try {
      const ac = getAudioContext();
      const src = ac.createBufferSource();
      const g = ac.createGain();
      src.buffer = buf;
      g.gain.value = v;
      src.connect(g).connect(ac.destination);
      src.start();
    } catch {
      /* audio unavailable: sounds are optional */
    }
  });
}

/** Warm the cache so the first join/leave chime isn't delayed. */
export function preloadSounds() {
  for (const n of ['ui-join', 'ui-leave', 'ui-message', 'ui-pop', 'ui-hand']) void loadSfx(n);
}

export const sounds = {
  join: () => play('ui-join', 0.5),
  leave: () => play('ui-leave', 0.5),
  message: () => play('ui-message', 0.4),
  selfJoin: () => play('ui-selfjoin', 0.45),
  hand: () => play('ui-hand', 0.5),
  pop: () => play('ui-pop', 0.35),
  shutter: () => play('ui-shutter', 0.7, true),
  tick: () => play('ui-tick', 0.5, true),
  secret: () => play('ui-secret', 0.6, true),
  party: () => play('ui-party', 0.6),
  ghost: () => play('ui-ghost', 0.6),
  timer: () => play('ui-timer', 0.6),
  test: () => play('ui-test', 0.8, true),
  // games & throwables
  correct: () => play('game-correct', 0.6),
  wrong: () => play('game-wrong', 0.45),
  win: () => play('game-win', 0.6),
  throw: () => play('game-throw', 0.5),
  splat: () => play('game-splat', 0.7),
  punch: () => play('game-punch', 0.7),
  wheel: () => play('game-wheel', 0.55),
  reveal: () => play('game-reveal', 0.6),
  coin: () => play('game-coin', 0.6),
};

export async function setSoundsSink(deviceId: string) {
  const ac = getAudioContext() as AudioContext & { setSinkId?: (id: string) => Promise<void> };
  if (ac.setSinkId) {
    try {
      await ac.setSinkId(deviceId || '');
    } catch {
      /* device gone: keep default */
    }
  }
}
