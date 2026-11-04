import type { VoiceFx } from '../lib/settings';

/**
 * Real-time voice effects built from WebAudio nodes. Only used when an effect is
 * picked; with "none" your mic goes out untouched (no added latency).
 */

export const VOICES: { id: VoiceFx; label: string; emoji: string }[] = [
  { id: 'none', label: 'Normal', emoji: '🙂' },
  { id: 'robot', label: 'Robot', emoji: '🤖' },
  { id: 'chipmunk', label: 'Chipmunk', emoji: '🐿️' },
  { id: 'deep', label: 'Deep', emoji: '🗿' },
  { id: 'alien', label: 'Alien', emoji: '👽' },
  { id: 'radio', label: 'Radio', emoji: '📻' },
  { id: 'megaphone', label: 'Megaphone', emoji: '📢' },
  { id: 'cave', label: 'Cave', emoji: '🦇' },
];

// Delay-line pitch shifter: two read heads sweeping a short buffer, crossfaded.
const PITCH_WORKLET = `
class YapaPitch extends AudioWorkletProcessor {
  static get parameterDescriptors() { return [{ name: 'ratio', defaultValue: 1, minValue: 0.25, maxValue: 4 }]; }
  constructor() { super(); this.N = 8192; this.buf = new Float32Array(this.N); this.w = 0; this.phase = 0; this.W = 1536; }
  read(d) {
    let p = this.w - d; while (p < 0) p += this.N;
    const i = Math.floor(p), f = p - i, a = this.buf[i % this.N], b = this.buf[(i + 1) % this.N];
    return a + (b - a) * f;
  }
  process(inputs, outputs, params) {
    const input = inputs[0] && inputs[0][0];
    const out = outputs[0][0];
    if (!out) return true;
    const ratio = params.ratio[0];
    const W = this.W;
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = input ? input[i] : 0;
      this.phase += 1 - ratio;
      while (this.phase < 0) this.phase += W;
      while (this.phase >= W) this.phase -= W;
      const d1 = this.phase, d2 = (this.phase + W / 2) % W;
      const g1 = 1 - Math.abs((2 * d1) / W - 1), g2 = 1 - Math.abs((2 * d2) / W - 1);
      out[i] = this.read(d1 + 1) * g1 + this.read(d2 + 1) * g2;
      this.w = (this.w + 1) % this.N;
    }
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    return true;
  }
}
registerProcessor('yapa-pitch', YapaPitch);
`;

const workletLoaded = new WeakMap<BaseAudioContext, Promise<boolean>>();
function loadWorklet(ctx: AudioContext) {
  let p = workletLoaded.get(ctx);
  if (!p) {
    const url = URL.createObjectURL(new Blob([PITCH_WORKLET], { type: 'text/javascript' }));
    p = ctx.audioWorklet
      .addModule(url)
      .then(() => true)
      .catch(() => false);
    workletLoaded.set(ctx, p);
  }
  return p;
}

function distortion(ctx: AudioContext, amount: number) {
  const ws = ctx.createWaveShaper();
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

function impulse(ctx: AudioContext, seconds: number, decay: number) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return b;
}

export interface VoiceChain {
  output: MediaStreamTrack;
  stop(): void;
}

/** Build an effect chain around a mic track. Returns null for "none". */
export async function buildVoiceChain(ctx: AudioContext, mic: MediaStreamTrack, fx: VoiceFx): Promise<VoiceChain | null> {
  if (fx === 'none') return null;
  const src = ctx.createMediaStreamSource(new MediaStream([mic]));
  const dest = ctx.createMediaStreamDestination();
  const out = ctx.createGain();
  out.connect(dest);
  const oscs: OscillatorNode[] = [];
  const nodes: AudioNode[] = [src, out];

  const ringMod = (freq: number) => {
    const ring = ctx.createGain();
    ring.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.connect(ring.gain);
    osc.start();
    oscs.push(osc);
    nodes.push(ring);
    return { ring, osc };
  };

  if (fx === 'robot') {
    const { ring } = ringMod(55);
    const delay = ctx.createDelay();
    delay.delayTime.value = 0.008;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    src.connect(ring);
    ring.connect(delay);
    delay.connect(fb).connect(delay);
    ring.connect(out);
    delay.connect(out);
    out.gain.value = 1.6;
    nodes.push(delay, fb);
  } else if (fx === 'alien') {
    const { ring, osc } = ringMod(260);
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 5;
    lfoGain.gain.value = 90;
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start();
    oscs.push(lfo);
    const dry = ctx.createGain();
    dry.gain.value = 0.35;
    src.connect(ring).connect(out);
    src.connect(dry).connect(out);
    out.gain.value = 1.4;
    nodes.push(lfoGain, dry);
  } else if (fx === 'radio' || fx === 'megaphone') {
    const hp = ctx.createBiquadFilter();
    const lp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    lp.type = 'lowpass';
    hp.frequency.value = fx === 'radio' ? 550 : 900;
    lp.frequency.value = fx === 'radio' ? 2900 : 2400;
    const dist = distortion(ctx, fx === 'radio' ? 25 : 120);
    const comp = ctx.createDynamicsCompressor();
    src.connect(hp).connect(lp).connect(dist).connect(comp).connect(out);
    out.gain.value = fx === 'radio' ? 1.2 : 0.9;
    nodes.push(hp, lp, dist, comp);
  } else if (fx === 'cave') {
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 2.8, 2.2);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    const dry = ctx.createGain();
    dry.gain.value = 0.75;
    src.connect(conv).connect(wet).connect(out);
    src.connect(dry).connect(out);
    nodes.push(conv, wet, dry);
  } else if (fx === 'chipmunk' || fx === 'deep') {
    if (!(await loadWorklet(ctx))) {
      src.connect(out);
    } else {
      const shifter = new AudioWorkletNode(ctx, 'yapa-pitch', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      shifter.parameters.get('ratio')!.value = fx === 'chipmunk' ? 1.7 : 0.68;
      src.connect(shifter).connect(out);
      nodes.push(shifter);
    }
  }

  return {
    output: dest.stream.getAudioTracks()[0],
    stop() {
      oscs.forEach((o) => {
        try {
          o.stop();
        } catch {
          /* ignore */
        }
      });
      nodes.forEach((n) => n.disconnect());
      dest.stream.getTracks().forEach((t) => t.stop());
    },
  };
}
