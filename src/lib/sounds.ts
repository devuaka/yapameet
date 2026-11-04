import { getSettings } from './settings';

/** Join/leave/chat sounds synthesized with WebAudio, so there are no asset files. */
let ctx: AudioContext | null = null;

export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  return ctx;
}

type Note = [freq: number, start: number, dur: number];

function play(notes: Note[], volume = 0.12, type: OscillatorType = 'sine') {
  if (!getSettings().sounds) return;
  try {
    const ac = getAudioContext();
    const t0 = ac.currentTime + 0.02;
    for (const [freq, start, dur] of notes) {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, t0 + start);
      gain.gain.linearRampToValueAtTime(volume, t0 + start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.connect(gain).connect(ac.destination);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.05);
    }
  } catch {
    /* audio unavailable: sounds are optional */
  }
}

export const sounds = {
  join: () => play([[660, 0, 0.18], [880, 0.11, 0.26]]),
  leave: () => play([[700, 0, 0.18], [470, 0.12, 0.3]]),
  message: () => play([[1040, 0, 0.12]], 0.07, 'triangle'),
  selfJoin: () => play([[523, 0, 0.16], [659, 0.1, 0.16], [784, 0.2, 0.3]], 0.1),
  test: () => play([[440, 0, 0.25], [554, 0.22, 0.25], [659, 0.44, 0.4]], 0.15),
};

/** Route synthesized sounds to the chosen output device where supported (Chrome/Edge 110+). */
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
