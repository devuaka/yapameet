import { getAudioContext } from '../lib/sounds';

/**
 * Records the call exactly as you see it: every visible tile is composited onto a
 * canvas, and all call audio (everyone's mic, screen audio, soundboard, your mic)
 * is mixed with WebAudio. Saved locally as a .webm file; nothing is uploaded.
 */

interface DrawOpts {
  watermark?: string;
}

function drawStage(stage: HTMLElement, g: CanvasRenderingContext2D, W: number, H: number, opts: DrawOpts = {}) {
  const sr = stage.getBoundingClientRect();
  const sx = W / Math.max(1, sr.width);
  const sy = H / Math.max(1, sr.height);
  g.fillStyle = '#0b0c15';
  g.fillRect(0, 0, W, H);
  const tiles = stage.querySelectorAll<HTMLElement>('.tile');
  tiles.forEach((tile) => {
    const r = tile.getBoundingClientRect();
    const x = (r.left - sr.left) * sx;
    const y = (r.top - sr.top) * sy;
    const w = r.width * sx;
    const h = r.height * sy;
    if (w < 4 || h < 4) return;
    g.save();
    g.beginPath();
    g.roundRect(x, y, w, h, 12 * sx);
    g.clip();
    g.fillStyle = '#161829';
    g.fillRect(x, y, w, h);
    const v = tile.querySelector('video');
    const img = tile.querySelector<HTMLImageElement>('img.ghost-room, img.bot-img');
    const frozen = tile.querySelector<HTMLCanvasElement>('canvas.ghost-freeze');
    if (img?.complete) g.drawImage(img, x, y, w, h);
    if (v && v.videoWidth) {
      const contain = getComputedStyle(v).objectFit === 'contain';
      const s = contain ? Math.min(w / v.videoWidth, h / v.videoHeight) : Math.max(w / v.videoWidth, h / v.videoHeight);
      const dw = v.videoWidth * s;
      const dh = v.videoHeight * s;
      g.save();
      if (v.classList.contains('mirror')) {
        g.translate(x + w, y);
        g.scale(-1, 1);
        g.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      g.restore();
    } else if (frozen && frozen.width) {
      g.globalAlpha = Number(getComputedStyle(frozen).opacity) || 0;
      g.drawImage(frozen, x, y, w, h);
      g.globalAlpha = 1;
    } else if (!img && tile.querySelector<HTMLImageElement>('img.avatar-img')?.complete) {
      const pic = tile.querySelector<HTMLImageElement>('img.avatar-img')!;
      const rad = Math.min(w, h) * 0.2;
      g.save();
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, rad, 0, Math.PI * 2);
      g.clip();
      g.drawImage(pic, x + w / 2 - rad, y + h / 2 - rad, rad * 2, rad * 2);
      g.restore();
    } else if (!img) {
      const avatar = tile.querySelector<HTMLElement>('.avatar');
      const rad = Math.min(w, h) * 0.18;
      g.fillStyle = '#7c5cf6';
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, rad, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(rad * 0.8)}px sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(avatar?.textContent ?? '?', x + w / 2, y + h / 2);
    }
    const vanished = tile.querySelector<HTMLImageElement>('img.smite-room');
    if (vanished?.complete && vanished.naturalWidth) {
      const s = Math.max(w / vanished.naturalWidth, h / vanished.naturalHeight);
      const dw = vanished.naturalWidth * s;
      const dh = vanished.naturalHeight * s;
      g.save();
      g.globalAlpha = Number(getComputedStyle(vanished).opacity) || 0;
      if (vanished.classList.contains('mirror')) {
        g.translate(x + w, y);
        g.scale(-1, 1);
        g.drawImage(vanished, (w - dw) / 2, (h - dh) / 2, dw, dh);
      } else g.drawImage(vanished, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
      g.restore();
    }
    if (tile.classList.contains('speaking')) {
      g.strokeStyle = '#a78bfa';
      g.lineWidth = 4 * sx;
      g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    }
    const label = tile.querySelector<HTMLElement>('.tile-label span')?.textContent;
    if (label) {
      const fs = Math.max(11, Math.round(13 * sx));
      g.font = `600 ${fs}px sans-serif`;
      const tw = g.measureText(label).width;
      g.fillStyle = 'rgba(8,9,16,0.65)';
      g.beginPath();
      g.roundRect(x + 8 * sx, y + h - fs - 18 * sy, tw + 18 * sx, fs + 10 * sy, 8 * sx);
      g.fill();
      g.fillStyle = '#fff';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(label, x + 17 * sx, y + h - fs / 2 - 13 * sy);
    }
    g.restore();
  });
  const caption = document.querySelector<HTMLElement>('.captions-overlay');
  if (caption?.innerText.trim()) {
    const lines = caption.innerText.trim().split('\n').slice(-3);
    const fs = Math.round(H / 28);
    g.font = `600 ${fs}px sans-serif`;
    g.textAlign = 'center';
    lines.forEach((l, i) => {
      const yy = H - (lines.length - i) * (fs * 1.5) - 10;
      const tw = g.measureText(l).width;
      g.fillStyle = 'rgba(0,0,0,0.7)';
      g.fillRect(W / 2 - tw / 2 - 10, yy - fs, tw + 20, fs * 1.35);
      g.fillStyle = '#fff';
      g.fillText(l, W / 2, yy);
    });
  }
  if (opts.watermark) {
    g.font = `700 ${Math.round(H / 40)}px sans-serif`;
    g.textAlign = 'right';
    g.textBaseline = 'top';
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillText(opts.watermark, W - 14, 12);
  }
}

function canvasSize(stage: HTMLElement, width = 1280) {
  const r = stage.getBoundingClientRect();
  const W = width;
  const H = Math.round((width * r.height) / Math.max(1, r.width) / 2) * 2;
  return { W, H: Math.max(180, Math.min(H, 1440)) };
}

/** One-shot "group photo" of the stage. */
export async function snapshotStage(stage: HTMLElement): Promise<Blob | null> {
  const { W, H } = canvasSize(stage, 1920);
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  drawStage(stage, c.getContext('2d')!, W, H, { watermark: `Yapameet · ${new Date().toLocaleString()}` });
  return new Promise((res) => c.toBlob(res, 'image/png'));
}

export class CallRecorder {
  startedAt = 0;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private worker: Worker | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private sources = new Map<string, MediaStreamAudioSourceNode>();
  private audioTimer = 0;
  private canvas = document.createElement('canvas');

  constructor(
    private stage: () => HTMLElement | null,
    private audioStreams: () => MediaStream[],
  ) {}

  get recording() {
    return this.recorder?.state === 'recording';
  }

  start(): boolean {
    const stage = this.stage();
    if (!stage || this.recording || typeof MediaRecorder === 'undefined') return false;
    const { W, H } = canvasSize(stage);
    this.canvas.width = W;
    this.canvas.height = H;
    const g = this.canvas.getContext('2d')!;
    const video = this.canvas.captureStream(30);

    const ctx = getAudioContext();
    this.dest = ctx.createMediaStreamDestination();
    const syncAudio = () => {
      const want = new Map<string, MediaStreamTrack>();
      for (const s of this.audioStreams()) for (const t of s.getAudioTracks()) if (t.readyState === 'live') want.set(t.id, t);
      for (const [id, node] of this.sources) {
        if (!want.has(id)) {
          node.disconnect();
          this.sources.delete(id);
        }
      }
      for (const [id, t] of want) {
        if (this.sources.has(id)) continue;
        const node = ctx.createMediaStreamSource(new MediaStream([t]));
        node.connect(this.dest!);
        this.sources.set(id, node);
      }
    };
    syncAudio();
    this.audioTimer = window.setInterval(syncAudio, 1000);

    // Worker ticks keep drawing even when this tab is in the background.
    this.worker = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 33)'], { type: 'text/javascript' })));
    this.worker.onmessage = () => {
      const st = this.stage();
      if (st) drawStage(st, g, W, H, { watermark: `● REC ${formatElapsed(Date.now() - this.startedAt)}` });
    };

    const tracks = [...video.getVideoTracks(), ...this.dest.stream.getAudioTracks()];
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    this.recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: mime, videoBitsPerSecond: 4_000_000 });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.recorder.start(1000);
    this.startedAt = Date.now();
    return true;
  }

  stop(): Promise<Blob | null> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(null);
    return new Promise((resolve) => {
      rec.onstop = () => {
        const blob = this.chunks.length ? new Blob(this.chunks, { type: rec.mimeType || 'video/webm' }) : null;
        this.cleanup();
        resolve(blob);
      };
      try {
        rec.stop();
      } catch {
        this.cleanup();
        resolve(null);
      }
    });
  }

  private cleanup() {
    this.worker?.terminate();
    this.worker = null;
    clearInterval(this.audioTimer);
    for (const n of this.sources.values()) n.disconnect();
    this.sources.clear();
    this.dest?.stream.getTracks().forEach((t) => t.stop());
    this.dest = null;
    this.recorder?.stream.getTracks().forEach((t) => t.stop());
    this.recorder = null;
  }
}

export function formatElapsed(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
