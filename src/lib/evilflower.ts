import { getSettings } from './settings';
import { getAudioContext, loadSfx } from './sounds';

/**
 * Easter egg "Evil Flower" (type evilflower in Activities > Games > Commands).
 * A party that doesn't stop: evil disco lights and a cackle on a loop, on every
 * screen in the call, until someone types it again.
 */
let on = false;
let src: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;

export const evilPartyOn = () => on;

export async function startEvilParty() {
  if (on) return;
  on = true;
  if (!getSettings().reduceMotion) document.documentElement.classList.add('fx-evil');
  const buf = await loadSfx('egg-evilflower');
  if (!on || !buf) return;
  const ctx = getAudioContext();
  const s = getSettings();
  gain = ctx.createGain();
  gain.gain.value = s.sounds ? 0.9 * s.soundVolume : 0;
  src = ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.connect(gain).connect(ctx.destination);
  src.start();
}

export function stopEvilParty() {
  on = false;
  document.documentElement.classList.remove('fx-evil');
  try {
    src?.stop();
  } catch {
    /* already stopped */
  }
  src?.disconnect();
  gain?.disconnect();
  src = gain = null;
}
