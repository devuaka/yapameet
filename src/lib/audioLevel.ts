import { getAudioContext } from './sounds';

/**
 * Speaking detection. Polls analysers on a timer (not rAF, which stops in background
 * tabs) and keeps its own store so level changes don't re-render the whole meeting.
 */
interface Entry {
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  buf: Float32Array;
  level: number;
  speaking: boolean;
  lastLoud: number;
  trackId: string;
}

const THRESHOLD = 0.018;
const HOLD_MS = 350;

class AudioLevels {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private timer: number | null = null;

  /** Attach (or re-attach when the track changed) a stream under an id. */
  watch(id: string, stream: MediaStream | null | undefined) {
    const track = stream?.getAudioTracks()[0];
    const existing = this.entries.get(id);
    if (existing && track && existing.trackId === track.id) return;
    this.unwatch(id);
    if (!track || track.readyState === 'ended') return;
    try {
      const ac = getAudioContext();
      const source = ac.createMediaStreamSource(new MediaStream([track]));
      const analyser = ac.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.3;
      source.connect(analyser);
      this.entries.set(id, {
        source,
        analyser,
        buf: new Float32Array(analyser.fftSize),
        level: 0,
        speaking: false,
        lastLoud: 0,
        trackId: track.id,
      });
      this.ensureTimer();
    } catch (err) {
      console.warn('[yapameet] audio level monitor failed', err);
    }
  }

  unwatch(id: string) {
    const e = this.entries.get(id);
    if (!e) return;
    try {
      e.source.disconnect();
    } catch {
      /* already disconnected */
    }
    this.entries.delete(id);
    if (e.speaking || e.level) this.notify(id);
    if (!this.entries.size && this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.unwatch(id);
  }

  level(id: string) {
    return this.entries.get(id)?.level ?? 0;
  }

  speaking(id: string) {
    return this.entries.get(id)?.speaking ?? false;
  }

  subscribe(id: string, fn: () => void) {
    let set = this.listeners.get(id);
    if (!set) this.listeners.set(id, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
    };
  }

  private notify(id: string) {
    this.listeners.get(id)?.forEach((fn) => fn());
  }

  private ensureTimer() {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), 90);
  }

  private tick() {
    const now = performance.now();
    for (const [id, e] of this.entries) {
      e.analyser.getFloatTimeDomainData(e.buf as Float32Array<ArrayBuffer>);
      let sum = 0;
      for (let i = 0; i < e.buf.length; i++) sum += e.buf[i] * e.buf[i];
      const rms = Math.sqrt(sum / e.buf.length);
      const level = Math.min(1, rms * 6);
      if (rms > THRESHOLD) e.lastLoud = now;
      const speaking = now - e.lastLoud < HOLD_MS;
      const changed = speaking !== e.speaking || Math.abs(level - e.level) > 0.02;
      e.level = level;
      e.speaking = speaking;
      if (changed) this.notify(id);
    }
  }
}

export const audioLevels = new AudioLevels();
