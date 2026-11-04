/**
 * Virtual backgrounds. Presets are painted procedurally on a canvas (no image
 * files, nothing to license). Custom uploads are downscaled to 1280x720 JPEGs and
 * kept in localStorage.
 */
export interface BgPreset {
  id: string;
  label: string;
  paint: (g: CanvasRenderingContext2D, w: number, h: number) => void;
}

function rng(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const lin = (g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, stops: [number, string][]) => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
};
const rad = (g: CanvasRenderingContext2D, x: number, y: number, r: number, stops: [number, string][]) => {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
};

export const BG_PRESETS: BgPreset[] = [
  {
    id: 'aurora',
    label: 'Aurora',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#050816'], [1, '#0d1b2a']]);
      g.fillRect(0, 0, w, h);
      const r = rng(7);
      for (let i = 0; i < 140; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.7})`;
        g.fillRect(r() * w, r() * h * 0.6, 1.5, 1.5);
      }
      g.globalCompositeOperation = 'lighter';
      for (const [c, y, a] of [
        ['#22d3ee', 0.35, 0.35],
        ['#a78bfa', 0.45, 0.3],
        ['#34d399', 0.55, 0.28],
      ] as const) {
        g.fillStyle = lin(g, 0, h * (y - 0.2), 0, h * (y + 0.25), [[0, 'transparent'], [0.5, c], [1, 'transparent']]);
        g.globalAlpha = a;
        g.beginPath();
        g.moveTo(0, h * y);
        for (let x = 0; x <= w; x += w / 8) g.quadraticCurveTo(x + w / 16, h * (y - 0.12 + r() * 0.24), x + w / 8, h * y);
        g.lineTo(w, h);
        g.lineTo(0, h);
        g.fill();
      }
      g.globalAlpha = 1;
      g.globalCompositeOperation = 'source-over';
      g.fillStyle = lin(g, 0, h * 0.75, 0, h, [[0, 'transparent'], [1, '#02040a']]);
      g.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#2b1055'], [0.45, '#d53369'], [0.7, '#f8a35b'], [1, '#fcd581']]);
      g.fillRect(0, 0, w, h);
      g.fillStyle = rad(g, w * 0.5, h * 0.68, h * 0.28, [[0, '#fff3c4'], [0.6, '#ffd36e'], [1, 'transparent']]);
      g.fillRect(0, 0, w, h);
      for (const [y, c] of [
        [0.78, '#3a1c4a'],
        [0.86, '#24112f'],
      ] as const) {
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(0, h);
        const r = rng(Math.round(y * 100));
        for (let x = 0; x <= w; x += w / 10) g.lineTo(x, h * (y - r() * 0.08));
        g.lineTo(w, h);
        g.fill();
      }
    },
  },
  {
    id: 'ocean',
    label: 'Deep sea',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#0ea5e9'], [0.5, '#075985'], [1, '#0c1e3a']]);
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const r = rng(3);
      for (let i = 0; i < 9; i++) {
        g.fillStyle = 'rgba(186,230,253,0.07)';
        const x = r() * w;
        g.beginPath();
        g.moveTo(x, 0);
        g.lineTo(x + w * 0.05, 0);
        g.lineTo(x + w * 0.2 - r() * w * 0.1, h);
        g.lineTo(x - w * 0.05, h);
        g.fill();
      }
      for (let i = 0; i < 40; i++) {
        g.strokeStyle = `rgba(255,255,255,${0.15 + r() * 0.3})`;
        g.beginPath();
        g.arc(r() * w, h * 0.3 + r() * h * 0.7, 2 + r() * 8, 0, Math.PI * 2);
        g.stroke();
      }
      g.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'loft',
    label: 'Cozy loft',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, 0, h, [[0, '#3b2f2f'], [1, '#1c1412']]);
      g.fillRect(0, 0, w, h);
      // window with warm light
      g.fillStyle = rad(g, w * 0.72, h * 0.35, w * 0.4, [[0, 'rgba(255,214,150,0.55)'], [1, 'transparent']]);
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4d9a6';
      g.fillRect(w * 0.58, h * 0.12, w * 0.28, h * 0.45);
      g.fillStyle = '#3b2f2f';
      g.fillRect(w * 0.715, h * 0.12, w * 0.012, h * 0.45);
      g.fillRect(w * 0.58, h * 0.33, w * 0.28, h * 0.012);
      // shelf + plants + books
      g.fillStyle = '#5b4636';
      g.fillRect(w * 0.06, h * 0.42, w * 0.36, h * 0.025);
      const r = rng(11);
      const cols = ['#c2410c', '#0f766e', '#a16207', '#7c3aed', '#be123c'];
      let x = w * 0.08;
      while (x < w * 0.3) {
        const bw = w * (0.012 + r() * 0.014);
        const bh = h * (0.08 + r() * 0.06);
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        g.fillRect(x, h * 0.42 - bh, bw, bh);
        x += bw + 2;
      }
      g.fillStyle = '#365314';
      for (let i = 0; i < 7; i++) {
        g.beginPath();
        g.ellipse(w * 0.36 + (r() - 0.5) * w * 0.05, h * 0.36 - r() * h * 0.06, w * 0.02, h * 0.05, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = '#7c2d12';
      g.fillRect(w * 0.34, h * 0.36, w * 0.04, h * 0.06);
      g.fillStyle = lin(g, 0, h * 0.8, 0, h, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,0.6)']]);
      g.fillRect(0, 0, w, h);
      g.filter = 'none';
    },
  },
  {
    id: 'synthwave',
    label: 'Synthwave',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, 0, h * 0.6, [[0, '#120024'], [1, '#ff2a6d']]);
      g.fillRect(0, 0, w, h * 0.6);
      g.fillStyle = lin(g, 0, h * 0.15, 0, h * 0.6, [[0, '#ffe66d'], [1, '#ff2a6d']]);
      g.beginPath();
      g.arc(w / 2, h * 0.6, h * 0.3, Math.PI, 0);
      g.fill();
      g.fillStyle = '#120024';
      for (let i = 0; i < 6; i++) g.fillRect(w / 2 - h * 0.3, h * (0.42 + i * 0.03), h * 0.6, h * (0.004 + i * 0.002));
      g.fillStyle = '#0b0018';
      g.fillRect(0, h * 0.6, w, h * 0.4);
      g.strokeStyle = '#05d9e8';
      g.lineWidth = 2;
      for (let i = 0; i <= 20; i++) {
        g.beginPath();
        g.moveTo(w / 2, h * 0.6);
        g.lineTo((i / 20) * w * 3 - w, h);
        g.stroke();
      }
      for (let i = 1; i < 10; i++) {
        const y = h * 0.6 + h * 0.4 * Math.pow(i / 10, 2);
        g.beginPath();
        g.moveTo(0, y);
        g.lineTo(w, y);
        g.stroke();
      }
    },
  },
  {
    id: 'nebula',
    label: 'Nebula',
    paint(g, w, h) {
      g.fillStyle = '#05010f';
      g.fillRect(0, 0, w, h);
      g.globalCompositeOperation = 'lighter';
      const r = rng(21);
      for (const c of ['rgba(139,92,246,0.35)', 'rgba(236,72,153,0.3)', 'rgba(59,130,246,0.3)', 'rgba(20,184,166,0.2)']) {
        for (let i = 0; i < 4; i++) {
          g.fillStyle = rad(g, r() * w, r() * h, w * (0.15 + r() * 0.25), [[0, c], [1, 'transparent']]);
          g.fillRect(0, 0, w, h);
        }
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = `rgba(255,255,255,${r()})`;
        const s = r() < 0.05 ? 2.5 : 1.2;
        g.fillRect(r() * w, r() * h, s, s);
      }
      g.globalCompositeOperation = 'source-over';
    },
  },
  {
    id: 'studio',
    label: 'Studio',
    paint(g, w, h) {
      g.fillStyle = rad(g, w * 0.5, h * 0.4, w * 0.7, [[0, '#4b5563'], [1, '#111827']]);
      g.fillRect(0, 0, w, h);
    },
  },
  {
    id: 'mint',
    label: 'Mint',
    paint(g, w, h) {
      g.fillStyle = lin(g, 0, 0, w, h, [[0, '#d1fae5'], [1, '#a7f3d0']]);
      g.fillRect(0, 0, w, h);
      const r = rng(5);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = `rgba(16,185,129,${0.08 + r() * 0.12})`;
        g.beginPath();
        g.arc(r() * w, r() * h, h * (0.05 + r() * 0.2), 0, Math.PI * 2);
        g.fill();
      }
    },
  },
];

const CUSTOM_KEY = 'yapameet:customBgs';
export const MAX_CUSTOM = 8;

export function getCustomBgs(): string[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveCustomBgs(list: string[]) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(list.slice(0, MAX_CUSTOM)));
}

/** Downscale (cover-crop) an uploaded image to 1280x720 JPEG and store it. Returns its id. */
export async function addCustomBg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = 1280;
  c.height = 720;
  const g = c.getContext('2d')!;
  const s = Math.max(c.width / bmp.width, c.height / bmp.height);
  g.drawImage(bmp, (c.width - bmp.width * s) / 2, (c.height - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  bmp.close();
  const url = c.toDataURL('image/jpeg', 0.82);
  const list = [url, ...getCustomBgs()].slice(0, MAX_CUSTOM);
  try {
    saveCustomBgs(list);
  } catch {
    // localStorage full: drop the oldest and retry once.
    saveCustomBgs(list.slice(0, Math.max(1, list.length - 2)));
  }
  return 'custom:0';
}

export function removeCustomBg(index: number) {
  const list = getCustomBgs();
  list.splice(index, 1);
  saveCustomBgs(list);
}

const cache = new Map<string, Promise<ImageBitmap | null>>();

/** Background bitmap for an id like "preset:aurora" or "custom:2" (or a raw data URL). */
export function loadBackground(id: string, w = 1280, h = 720): Promise<ImageBitmap | null> {
  const key = `${id}@${w}x${h}`;
  if (id.startsWith('custom:')) {
    const url = getCustomBgs()[Number(id.slice(7))];
    if (!url) return Promise.resolve(null);
    return loadUrl(url);
  }
  if (id.startsWith('data:')) return loadUrl(id);
  let p = cache.get(key);
  if (!p) {
    const preset = BG_PRESETS.find((b) => `preset:${b.id}` === id) ?? BG_PRESETS[0];
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    preset.paint(c.getContext('2d')!, w, h);
    p = createImageBitmap(c);
    cache.set(key, p);
  }
  return p;
}

async function loadUrl(url: string): Promise<ImageBitmap | null> {
  try {
    const blob = await (await fetch(url)).blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Small preview thumbnail data URL for the picker. */
export function presetThumb(p: BgPreset): string {
  const c = document.createElement('canvas');
  c.width = 160;
  c.height = 90;
  p.paint(c.getContext('2d')!, 160, 90);
  return c.toDataURL('image/jpeg', 0.8);
}
