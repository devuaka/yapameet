import { getSettings } from './settings';

/** All sounds are synthesized with WebAudio, so there are no audio asset files. */
let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

type Note = [freq: number, start: number, dur: number, type?: OscillatorType];

function play(notes: Note[], volume = 0.12, type: OscillatorType = 'sine', force = false) {
  const s = getSettings();
  if (!s.sounds && !force) return;
  const v = volume * (force ? 1 : s.soundVolume);
  if (v <= 0) return;
  try {
    const ac = getAudioContext();
    const t0 = ac.currentTime + 0.02;
    for (const [freq, start, dur, t] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = t ?? type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(v, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  } catch {
    /* audio unavailable: sounds are optional */
  }
}

/** A soft breathy "woooo" for ghost mode: a sine sliding down with vibrato. */
function ghostWoo() {
  const s = getSettings();
  if (!s.sounds) return;
  try {
    const ac = getAudioContext();
    const t0 = ac.currentTime + 0.02;
    const osc = ac.createOscillator();
    const lfo = ac.createOscillator();
    const lfoGain = ac.createGain();
    const gain = ac.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620, t0);
    osc.frequency.exponentialRampToValueAtTime(260, t0 + 2.2);
    lfo.frequency.value = 6;
    lfoGain.gain.value = 18;
    lfo.connect(lfoGain).connect(osc.frequency);
    const v = 0.07 * s.soundVolume;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(v, t0 + 0.4);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.4);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0);
    lfo.start(t0);
    osc.stop(t0 + 2.5);
    lfo.stop(t0 + 2.5);
  } catch {
    /* optional */
  }
}

export const sounds = {
  join: () => play([[660, 0, 0.18], [880, 0.11, 0.26]]),
  leave: () => play([[700, 0, 0.18], [470, 0.12, 0.3]]),
  message: () => play([[1040, 0, 0.12]], 0.07, 'triangle'),
  selfJoin: () => play([[523, 0, 0.16], [659, 0.1, 0.16], [784, 0.2, 0.3]], 0.1),
  hand: () => play([[880, 0, 0.12], [1175, 0.09, 0.2]], 0.08, 'triangle'),
  pop: () => play([[1400, 0, 0.06]], 0.05, 'sine'),
  shutter: () => play([[2200, 0, 0.03, 'square'], [1200, 0.04, 0.05, 'square']], 0.04, 'square', true),
  tick: () => play([[1000, 0, 0.05]], 0.06, 'sine', true),
  secret: () => play([[523, 0, 0.1], [659, 0.08, 0.1], [784, 0.16, 0.1], [1047, 0.24, 0.35]], 0.09, 'triangle', true),
  party: () =>
    play(
      [
        [523, 0, 0.12], [659, 0.12, 0.12], [784, 0.24, 0.12], [1047, 0.36, 0.18],
        [784, 0.54, 0.12], [1047, 0.66, 0.4],
      ],
      0.09,
      'square',
    ),
  ghost: ghostWoo,
  test: () => play([[440, 0, 0.25], [554, 0.22, 0.25], [659, 0.44, 0.4]], 0.15, 'sine', true),
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
