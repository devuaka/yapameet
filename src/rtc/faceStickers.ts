import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

/**
 * Face stickers (AR): MediaPipe face landmarks, stickers drawn onto the outgoing
 * video so everyone sees them. Runs locally, like background blur.
 */
export type StickerId = 'none' | 'shades' | 'crown' | 'tophat' | 'clown' | 'cat' | 'devil' | 'halo' | 'hearts' | 'mustache' | 'party';

export const STICKERS: { id: StickerId; label: string; emoji: string }[] = [
  { id: 'none', label: 'None', emoji: '🚫' },
  { id: 'shades', label: 'Shades', emoji: '🕶️' },
  { id: 'crown', label: 'Crown', emoji: '👑' },
  { id: 'tophat', label: 'Top hat', emoji: '🎩' },
  { id: 'party', label: 'Party', emoji: '🥳' },
  { id: 'clown', label: 'Clown', emoji: '🤡' },
  { id: 'cat', label: 'Cat ears', emoji: '🐱' },
  { id: 'devil', label: 'Devil', emoji: '😈' },
  { id: 'halo', label: 'Halo', emoji: '😇' },
  { id: 'hearts', label: 'Heart eyes', emoji: '😍' },
  { id: 'mustache', label: 'Mustache', emoji: '🥸' },
];

const MODEL_URL =
  (import.meta.env.VITE_FACE_MODEL_URL as string | undefined) ||
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task';

let landmarkerPromise: Promise<FaceLandmarker | null> | null = null;

export function getFaceLandmarker(): Promise<FaceLandmarker | null> {
  if (!landmarkerPromise) {
    landmarkerPromise = (async () => {
      try {
        const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
        const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe`);
        const make = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: 'VIDEO',
            numFaces: 3,
            outputFaceBlendshapes: false,
          });
        try {
          return await make('GPU');
        } catch {
          return await make('CPU');
        }
      } catch (err) {
        console.warn('[yapameet] face stickers unavailable', err);
        landmarkerPromise = null;
        return null;
      }
    })();
  }
  return landmarkerPromise;
}

type Pt = { x: number; y: number };
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Key points for one face in pixel space. */
interface Face {
  eyeL: Pt;
  eyeR: Pt;
  nose: Pt;
  top: Pt;
  chin: Pt;
  lipTop: Pt;
  angle: number;
  /** Distance between outer eye corners in px. */
  eyeSpan: number;
  faceH: number;
}

function toFace(lm: NormalizedLandmark[], w: number, h: number): Face {
  const p = (i: number) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const eyeL = p(33);
  const eyeR = p(263);
  const top = p(10);
  const chin = p(152);
  return {
    eyeL,
    eyeR,
    nose: p(4),
    top,
    chin,
    lipTop: p(0),
    angle: Math.atan2(eyeR.y - eyeL.y, eyeR.x - eyeL.x),
    eyeSpan: Math.hypot(eyeR.x - eyeL.x, eyeR.y - eyeL.y),
    faceH: Math.hypot(chin.x - top.x, chin.y - top.y),
  };
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
function smoothFace(prev: Face | undefined, next: Face): Face {
  if (!prev) return next;
  const k = 0.55;
  const sp = (a: Pt, b: Pt) => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k) });
  return {
    eyeL: sp(prev.eyeL, next.eyeL),
    eyeR: sp(prev.eyeR, next.eyeR),
    nose: sp(prev.nose, next.nose),
    top: sp(prev.top, next.top),
    chin: sp(prev.chin, next.chin),
    lipTop: sp(prev.lipTop, next.lipTop),
    angle: lerp(prev.angle, next.angle, k),
    eyeSpan: lerp(prev.eyeSpan, next.eyeSpan, k),
    faceH: lerp(prev.faceH, next.faceH, k),
  };
}

function emojiAt(g: Ctx, e: string, x: number, y: number, size: number, angle: number) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(e, 0, 0);
  g.restore();
}

/** A point "above" the forehead along the face's up direction. */
function above(f: Face, by: number): Pt {
  const ux = Math.sin(f.angle);
  const uy = -Math.cos(f.angle);
  return { x: f.top.x + ux * by, y: f.top.y + uy * by };
}

function drawSticker(g: Ctx, id: StickerId, f: Face) {
  const mid = { x: (f.eyeL.x + f.eyeR.x) / 2, y: (f.eyeL.y + f.eyeR.y) / 2 };
  switch (id) {
    case 'shades':
      emojiAt(g, '🕶️', mid.x, mid.y + f.eyeSpan * 0.05, f.eyeSpan * 1.7, f.angle);
      break;
    case 'crown': {
      const c = above(f, f.faceH * 0.22);
      emojiAt(g, '👑', c.x, c.y, f.eyeSpan * 1.6, f.angle);
      break;
    }
    case 'tophat': {
      const c = above(f, f.faceH * 0.38);
      emojiAt(g, '🎩', c.x, c.y, f.eyeSpan * 2.2, f.angle);
      break;
    }
    case 'party': {
      const c = above(f, f.faceH * 0.3);
      // Cone hat drawn by hand (there is no party-hat emoji), plus confetti emoji.
      g.save();
      g.translate(c.x, c.y);
      g.rotate(f.angle);
      const hw = f.eyeSpan * 0.55;
      const hh = f.eyeSpan * 1.2;
      const grd = g.createLinearGradient(-hw, 0, hw, 0);
      grd.addColorStop(0, '#ec4899');
      grd.addColorStop(0.5, '#facc15');
      grd.addColorStop(1, '#8b5cf6');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(-hw, hh * 0.45);
      g.lineTo(hw, hh * 0.45);
      g.lineTo(0, -hh * 0.55);
      g.closePath();
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(0, -hh * 0.55, hw * 0.22, 0, Math.PI * 2);
      g.fill();
      g.restore();
      emojiAt(g, '🎉', f.chin.x + f.eyeSpan * 0.9, f.chin.y - f.faceH * 0.15, f.eyeSpan * 0.7, f.angle);
      break;
    }
    case 'clown':
      g.save();
      g.fillStyle = '#ef4444';
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = f.eyeSpan * 0.08;
      g.beginPath();
      g.arc(f.nose.x, f.nose.y, f.eyeSpan * 0.22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath();
      g.arc(f.nose.x - f.eyeSpan * 0.07, f.nose.y - f.eyeSpan * 0.07, f.eyeSpan * 0.06, 0, Math.PI * 2);
      g.fill();
      g.restore();
      break;
    case 'cat':
    case 'devil': {
      const c = above(f, f.faceH * 0.08);
      g.save();
      g.translate(c.x, c.y);
      g.rotate(f.angle);
      const s = f.eyeSpan;
      for (const side of [-1, 1]) {
        g.fillStyle = id === 'cat' ? '#f5f5f4' : '#dc2626';
        g.beginPath();
        if (id === 'cat') {
          g.moveTo(side * s * 0.25, -s * 0.05);
          g.lineTo(side * s * 0.95, -s * 0.15);
          g.lineTo(side * s * 0.72, -s * 0.85);
        } else {
          g.moveTo(side * s * 0.25, -s * 0.05);
          g.quadraticCurveTo(side * s * 0.45, -s * 0.5, side * s * 0.75, -s * 0.85);
          g.lineTo(side * s * 0.6, -s * 0.05);
        }
        g.closePath();
        g.fill();
        if (id === 'cat') {
          g.fillStyle = '#f9a8d4';
          g.beginPath();
          g.moveTo(side * s * 0.4, -s * 0.12);
          g.lineTo(side * s * 0.82, -s * 0.18);
          g.lineTo(side * s * 0.69, -s * 0.62);
          g.closePath();
          g.fill();
        }
      }
      g.restore();
      if (id === 'cat') {
        // whiskers
        g.save();
        g.strokeStyle = 'rgba(255,255,255,0.85)';
        g.lineWidth = Math.max(1.5, f.eyeSpan * 0.025);
        g.translate(f.nose.x, f.nose.y);
        g.rotate(f.angle);
        for (const side of [-1, 1]) {
          for (const dy of [-0.06, 0.04, 0.14]) {
            g.beginPath();
            g.moveTo(side * f.eyeSpan * 0.18, f.eyeSpan * dy);
            g.lineTo(side * f.eyeSpan * 0.75, f.eyeSpan * (dy * 1.8 - 0.02));
            g.stroke();
          }
        }
        g.restore();
      }
      break;
    }
    case 'halo': {
      const c = above(f, f.faceH * 0.28);
      g.save();
      g.translate(c.x, c.y);
      g.rotate(f.angle);
      g.strokeStyle = '#fde047';
      g.shadowColor = '#fde047';
      g.shadowBlur = f.eyeSpan * 0.25;
      g.lineWidth = f.eyeSpan * 0.09;
      g.beginPath();
      g.ellipse(0, 0, f.eyeSpan * 0.85, f.eyeSpan * 0.22, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
      break;
    }
    case 'hearts':
      emojiAt(g, '❤️', f.eyeL.x + (f.eyeR.x - f.eyeL.x) * 0.12, f.eyeL.y, f.eyeSpan * 0.6, f.angle);
      emojiAt(g, '❤️', f.eyeR.x - (f.eyeR.x - f.eyeL.x) * 0.12, f.eyeR.y, f.eyeSpan * 0.6, f.angle);
      break;
    case 'mustache': {
      const x = (f.nose.x + f.lipTop.x) / 2;
      const y = (f.nose.y + f.lipTop.y) / 2;
      g.save();
      g.translate(x, y);
      g.rotate(f.angle);
      const s = f.eyeSpan * 0.55;
      g.fillStyle = '#1c1917';
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(0, -s * 0.05);
        g.bezierCurveTo(side * s * 0.4, -s * 0.35, side * s * 0.9, -s * 0.2, side * s * 1.05, s * 0.2);
        g.bezierCurveTo(side * s * 0.8, s * 0.05, side * s * 0.45, s * 0.25, 0, s * 0.12);
        g.closePath();
        g.fill();
      }
      g.restore();
      break;
    }
  }
}

/** Per-pipeline tracker: runs detection on a small frame and draws stickers at full size. */
export class StickerTracker {
  private lm: FaceLandmarker | null = null;
  private loading = false;
  private faces: Face[] = [];
  private lastTs = 0;
  private frame = 0;
  ready = false;

  async ensure() {
    if (this.lm || this.loading) return;
    this.loading = true;
    this.lm = await getFaceLandmarker();
    this.ready = !!this.lm;
    this.loading = false;
  }

  /** `small` is a downscaled copy of the current frame (same aspect). */
  update(small: CanvasImageSource, w: number, h: number) {
    if (!this.lm) {
      void this.ensure();
      return;
    }
    this.frame++;
    if (this.frame % 2) return; // every other frame is plenty; smoothing fills the gaps
    let ts = performance.now();
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;
    try {
      const res = this.lm.detectForVideo(small as HTMLCanvasElement, ts);
      const next = res.faceLandmarks.map((l) => toFace(l, w, h));
      this.faces = next.map((f, i) => smoothFace(this.faces[i], f));
    } catch {
      /* skip a frame */
    }
  }

  draw(g: Ctx, id: StickerId) {
    if (id === 'none') return;
    for (const f of this.faces) if (f.eyeSpan > 4) drawSticker(g, id, f);
  }
}
