import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { BgEffect, FilterId } from '../lib/settings';
import { loadBackground } from '../lib/backgrounds';

/**
 * Camera effects: background blur / replacement (MediaPipe selfie segmentation,
 * running locally in the browser on the GPU when available) and color filters.
 *
 * Chrome/Edge use insertable streams (MediaStreamTrackProcessor -> canvas ->
 * MediaStreamTrackGenerator), which keeps working when the tab is in the
 * background. Other browsers fall back to <video> + canvas.captureStream().
 */

export const FILTERS: Record<FilterId, { label: string; css: string }> = {
  none: { label: 'None', css: 'none' },
  warm: { label: 'Warm', css: 'sepia(0.22) saturate(1.25) hue-rotate(-8deg) brightness(1.03)' },
  cool: { label: 'Cool', css: 'saturate(1.1) hue-rotate(14deg) brightness(1.03)' },
  vivid: { label: 'Vivid', css: 'saturate(1.6) contrast(1.08)' },
  bw: { label: 'B&W', css: 'grayscale(1) contrast(1.1)' },
  noir: { label: 'Noir', css: 'grayscale(1) contrast(1.6) brightness(0.9)' },
  vintage: { label: 'Vintage', css: 'sepia(0.6) contrast(1.1) brightness(1.05) saturate(0.8)' },
  dream: { label: 'Dreamy', css: 'saturate(1.3) brightness(1.1) contrast(0.92) hue-rotate(-12deg)' },
  neon: { label: 'Neon', css: 'saturate(3) contrast(1.35) hue-rotate(80deg)' },
  thermal: { label: 'Thermal', css: 'invert(1) hue-rotate(180deg) saturate(4) contrast(1.5)' },
  invert: { label: 'Inverted', css: 'invert(1)' },
  pixel: { label: 'Pixel', css: 'saturate(1.3)' },
};

const LOW_LIGHT = 'brightness(1.35) contrast(1.06) saturate(1.12)';

export interface EffectOptions {
  bg: BgEffect;
  bgImage: string;
  filter: FilterId;
  lowLight: boolean;
}

export const effectsNeeded = (o: EffectOptions) => o.bg !== 'none' || o.filter !== 'none' || o.lowLight;

export function cssFilterFor(o: Pick<EffectOptions, 'filter' | 'lowLight'>) {
  const parts = [o.filter !== 'none' ? FILTERS[o.filter].css : '', o.lowLight ? LOW_LIGHT : ''].filter(Boolean);
  return parts.length ? parts.join(' ') : 'none';
}

const MODEL_URL =
  (import.meta.env.VITE_SEGMENTER_MODEL_URL as string | undefined) ||
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

let segmenterPromise: Promise<ImageSegmenter | null> | null = null;
export let segmenterError = '';

/** Loads once, shared by every pipeline. GPU first, CPU fallback. */
export function getSegmenter(): Promise<ImageSegmenter | null> {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      try {
        const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
        const make = (delegate: 'GPU' | 'CPU') =>
          ImageSegmenter.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            outputConfidenceMasks: true,
            outputCategoryMask: false,
          });
        try {
          return await make('GPU');
        } catch (err) {
          console.warn('[yapameet] GPU segmentation unavailable, using CPU', err);
          return await make('CPU');
        }
      } catch (err) {
        console.warn('[yapameet] background effects unavailable', err);
        segmenterError = 'Background effects could not load (offline or blocked). Your background is fully blurred instead.';
        segmenterPromise = null;
        return null;
      }
    })();
  }
  return segmenterPromise;
}

declare global {
  // Chromium "insertable streams" (not in TypeScript's DOM lib yet).
  // eslint-disable-next-line no-var
  var MediaStreamTrackProcessor: { new (init: { track: MediaStreamTrack; maxBufferSize?: number }): { readable: ReadableStream<VideoFrame> } } | undefined;
  // eslint-disable-next-line no-var
  var MediaStreamTrackGenerator: { new (init: { kind: 'video' | 'audio' }): MediaStreamTrack & { writable: WritableStream<VideoFrame> } } | undefined;
}

type Canvas = OffscreenCanvas | HTMLCanvasElement;
type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function makeCanvas(w: number, h: number, dom = false): Canvas {
  if (!dom && typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const ctx2d = (c: Canvas) => c.getContext('2d', { alpha: true }) as Ctx;

const SEG_W = 256;

export class EffectsPipeline {
  readonly output: MediaStreamTrack;
  private opts: EffectOptions;
  private stopped = false;
  private bgBitmap: ImageBitmap | null = null;
  private bgFor = '';
  private seg: ImageSegmenter | null = null;
  private segTried = false;
  private lastSegTs = 0;
  private segEvery = 1;
  private frameNo = 0;
  private hasMask = false;

  private out: Canvas;
  private outCtx: Ctx;
  private comp: Canvas = makeCanvas(2, 2);
  private compCtx = ctx2d(this.comp);
  private person: Canvas = makeCanvas(2, 2);
  private personCtx = ctx2d(this.person);
  private small: Canvas = makeCanvas(SEG_W, 144);
  private smallCtx = ctx2d(this.small);
  private mask: Canvas = makeCanvas(SEG_W, 144);
  private maskCtx = ctx2d(this.mask);
  private maskData = new ImageData(SEG_W, 144);
  private prevMask = new Float32Array(SEG_W * 144);
  private tiny: Canvas = makeCanvas(2, 2);
  private tinyCtx = ctx2d(this.tiny);
  private w = 0;
  private h = 0;
  private cleanup: () => void = () => {};

  constructor(
    readonly input: MediaStreamTrack,
    opts: EffectOptions,
  ) {
    this.opts = opts;
    const insertable = typeof MediaStreamTrackProcessor !== 'undefined' && typeof MediaStreamTrackGenerator !== 'undefined';
    this.out = makeCanvas(2, 2, !insertable);
    this.outCtx = ctx2d(this.out);
    if (insertable) this.output = this.runInsertable();
    else this.output = this.runFallback();
    this.output.contentHint = '';
    void this.prepare();
  }

  setOptions(opts: EffectOptions) {
    this.opts = opts;
    void this.prepare();
  }

  get segmenterReady() {
    return !!this.seg;
  }

  private async prepare() {
    const o = this.opts;
    if (o.bg !== 'none' && !this.seg && !this.segTried) {
      this.segTried = true;
      this.seg = await getSegmenter();
      if (!this.seg) this.segTried = false; // allow a retry later
    }
    if (o.bg === 'image' && this.bgFor !== o.bgImage) {
      this.bgFor = o.bgImage;
      this.bgBitmap = await loadBackground(o.bgImage);
    }
  }

  private resize(w: number, h: number) {
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    for (const c of [this.out, this.comp, this.person]) {
      c.width = w;
      c.height = h;
    }
    const sh = Math.max(2, Math.round((SEG_W * h) / w));
    this.small.width = this.mask.width = SEG_W;
    this.small.height = this.mask.height = sh;
    this.maskData = new ImageData(SEG_W, sh);
    this.prevMask = new Float32Array(SEG_W * sh);
    this.hasMask = false;
  }

  private updateMask(src: CanvasImageSource) {
    const seg = this.seg;
    if (!seg) return;
    this.frameNo++;
    if (this.hasMask && this.frameNo % this.segEvery !== 0) return;
    const sw = this.small.width;
    const sh = this.small.height;
    this.smallCtx.drawImage(src, 0, 0, sw, sh);
    let ts = performance.now();
    if (ts <= this.lastSegTs) ts = this.lastSegTs + 1;
    this.lastSegTs = ts;
    const t0 = performance.now();
    try {
      seg.segmentForVideo(this.small as HTMLCanvasElement, ts, (res) => {
        const m = res.confidenceMasks?.[0];
        if (!m) return;
        const arr = m.getAsFloat32Array();
        const data = this.maskData.data;
        const prev = this.prevMask;
        const n = Math.min(arr.length, prev.length);
        for (let i = 0; i < n; i++) {
          // Temporal smoothing kills edge flicker; the ramp sharpens the soft mask.
          const s = this.hasMask ? prev[i] * 0.35 + arr[i] * 0.65 : arr[i];
          prev[i] = s;
          const a = s <= 0.3 ? 0 : s >= 0.7 ? 255 : ((s - 0.3) / 0.4) * 255;
          const j = i * 4;
          data[j] = data[j + 1] = data[j + 2] = 255;
          data[j + 3] = a;
        }
        this.maskCtx.putImageData(this.maskData, 0, 0);
        this.hasMask = true;
      });
    } catch (err) {
      console.warn('[yapameet] segmentation frame failed', err);
    }
    // Adaptive: if segmentation is slow on this machine, run it every other frame.
    const took = performance.now() - t0;
    this.segEvery = took > 22 ? 2 : 1;
  }

  /** Composite one camera frame into the output canvas. */
  private render(src: CanvasImageSource, w: number, h: number) {
    this.resize(w, h);
    const o = this.opts;
    const filter = cssFilterFor(o);
    const post = filter !== 'none' || o.filter === 'pixel';
    const target = post ? this.compCtx : this.outCtx;

    if (o.bg !== 'none') {
      this.updateMask(src);
      const blurPx = Math.round((o.bg === 'blur-light' ? 0.006 : 0.014) * w) + 2;
      if (!this.hasMask) {
        // Effects still loading (or unavailable): never leak the real background.
        target.filter = `blur(${Math.round(w * 0.025)}px)`;
        target.drawImage(src, -40, -40, w + 80, h + 80);
        target.filter = 'none';
      } else {
        if (o.bg === 'image' && this.bgBitmap) {
          const b = this.bgBitmap;
          const s = Math.max(w / b.width, h / b.height);
          target.drawImage(b, (w - b.width * s) / 2, (h - b.height * s) / 2, b.width * s, b.height * s);
        } else {
          target.filter = `blur(${blurPx}px)`;
          target.drawImage(src, -blurPx * 2, -blurPx * 2, w + blurPx * 4, h + blurPx * 4);
          target.filter = 'none';
        }
        const p = this.personCtx;
        p.globalCompositeOperation = 'copy';
        p.filter = `blur(${Math.max(1, Math.round(w / 500))}px)`;
        p.drawImage(this.mask, 0, 0, w, h);
        p.filter = 'none';
        p.globalCompositeOperation = 'source-in';
        p.drawImage(src, 0, 0, w, h);
        p.globalCompositeOperation = 'source-over';
        target.drawImage(this.person, 0, 0);
      }
    } else {
      target.drawImage(src, 0, 0, w, h);
    }

    if (post) {
      const g = this.outCtx;
      if (o.filter === 'pixel') {
        const tw = Math.max(16, Math.round(w / 14));
        const th = Math.max(9, Math.round(h / 14));
        if (this.tiny.width !== tw || this.tiny.height !== th) {
          this.tiny.width = tw;
          this.tiny.height = th;
        }
        this.tinyCtx.imageSmoothingEnabled = true;
        this.tinyCtx.drawImage(this.comp, 0, 0, tw, th);
        g.imageSmoothingEnabled = false;
        g.filter = filter;
        g.drawImage(this.tiny, 0, 0, w, h);
        g.imageSmoothingEnabled = true;
      } else {
        g.filter = filter;
        g.drawImage(this.comp, 0, 0);
      }
      g.filter = 'none';
    }
  }

  private runInsertable(): MediaStreamTrack {
    const processor = new MediaStreamTrackProcessor!({ track: this.input, maxBufferSize: 1 });
    const generator = new MediaStreamTrackGenerator!({ kind: 'video' });
    const reader = processor.readable.getReader();
    const writer = generator.writable.getWriter();
    const loop = async () => {
      while (!this.stopped) {
        const { value: frame, done } = await reader.read();
        if (done || !frame) break;
        if (this.stopped) {
          frame.close();
          break;
        }
        try {
          this.render(frame, frame.displayWidth, frame.displayHeight);
          const outFrame = new VideoFrame(this.out as OffscreenCanvas, { timestamp: frame.timestamp ?? 0 });
          frame.close();
          await writer.write(outFrame);
        } catch (err) {
          frame.close();
          if (!this.stopped) console.warn('[yapameet] effects frame failed', err);
        }
      }
    };
    void loop();
    this.cleanup = () => {
      void reader.cancel().catch(() => {});
      void writer.close().catch(() => {});
    };
    return generator;
  }

  private runFallback(): MediaStreamTrack {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.srcObject = new MediaStream([this.input]);
    void video.play().catch(() => {});
    const canvas = this.out as HTMLCanvasElement;
    const fps = this.input.getSettings().frameRate || 30;
    const stream = canvas.captureStream(fps);
    let handle = 0;
    const tick = () => {
      if (this.stopped) return;
      if (video.videoWidth) this.render(video, video.videoWidth, video.videoHeight);
      handle = 'requestVideoFrameCallback' in video ? video.requestVideoFrameCallback(tick) : window.setTimeout(tick, 1000 / fps);
    };
    tick();
    this.cleanup = () => {
      if ('cancelVideoFrameCallback' in video) video.cancelVideoFrameCallback(handle);
      else clearTimeout(handle);
      video.srcObject = null;
    };
    return stream.getVideoTracks()[0];
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.cleanup();
    this.output.stop();
  }
}
