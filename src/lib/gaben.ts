import { audioLevels } from './audioLevel';
import { getAudioContext, loadSfx } from './sounds';

/**
 * Easter egg: in the meeting "gabenewel" a fake member joins, and every 36 seconds
 * he says one of his lines. The schedule follows the wall clock and the line is
 * picked from the slot number, so everyone in that meeting hears the same line
 * at the same moment.
 */
export const GABEN_ID = 'gaben-bot';
export const GABEN_NAME = 'Gabe Newell';
export const GABEN_IMAGE = `${import.meta.env.BASE_URL}eggs/gaben.webp`;
const PERIOD_MS = 36_000;
/** Files in public/sfx. The first one is also his hello when you join. */
const LINES = ['egg-gaben', 'egg-gaben-justme', 'egg-gaben-weight', 'egg-gaben-butt'];

/** Which line plays in a given 36 s slot: walks the list so no line repeats back to back. */
export const lineForSlot = (slot: number) => LINES[((slot % LINES.length) + LINES.length) % LINES.length];

export const isGabenCode = (code: string | null | undefined) => code === 'gabenewel' || code === 'gabenewell';

export class GabenBot {
  /** His "microphone": played like any other person (speaker choice, recordings, speaking ring). */
  readonly stream: MediaStream;
  private dest: MediaStreamAudioDestinationNode;
  private timers: number[] = [];
  private stopped = false;

  constructor() {
    const ctx = getAudioContext();
    this.dest = ctx.createMediaStreamDestination();
    this.stream = this.dest.stream;
    audioLevels.watch(GABEN_ID, this.stream);
  }

  start() {
    for (const l of LINES) void loadSfx(l);
    const now = Date.now();
    const next = Math.ceil(now / PERIOD_MS) * PERIOD_MS;
    // A hello right away if the next shared slot is far off.
    if (next - now > 8000) this.timers.push(window.setTimeout(() => this.say(LINES[0]), 1500));
    const onSlot = () => this.say(lineForSlot(Math.round(Date.now() / PERIOD_MS)));
    this.timers.push(
      window.setTimeout(() => {
        onSlot();
        this.timers.push(window.setInterval(onSlot, PERIOD_MS));
      }, next - now),
    );
  }

  private async say(line: string) {
    if (this.stopped) return;
    const buf = await loadSfx(line);
    if (!buf || this.stopped) return;
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.dest);
    src.start();
  }

  stop() {
    this.stopped = true;
    this.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    this.timers = [];
    audioLevels.unwatch(GABEN_ID);
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
