import { getSettings } from './settings';
import { getAudioContext, loadSfx } from './sounds';
import type { ToyId } from './toys';
import { fxBus } from './fx';
import { jumpscare } from './jumpscare';

/** Runs the secret toys' effects on this screen. Syncing between people lives in CallView. */

type Stop = () => void;
const active = new Map<ToyId, Stop>();
const motionOk = () => !getSettings().reduceMotion;

export const toyOn = (id: ToyId) => active.has(id);
export const activeToys = () => [...active.keys()];

export function setToy(id: ToyId, on: boolean) {
  if (on === active.has(id)) return;
  if (on) active.set(id, startToy(id));
  else {
    active.get(id)?.();
    active.delete(id);
  }
}

export function stopAllToys() {
  for (const stop of active.values()) stop();
  active.clear();
}

// ---------------------------------------------------------------- building blocks

function htmlClass(cls: string, needsMotion = false): Stop {
  if (needsMotion && !motionOk()) return () => {};
  document.documentElement.classList.add(cls);
  return () => document.documentElement.classList.remove(cls);
}

function overlay(cls: string, needsMotion = false): Stop {
  if (needsMotion && !motionOk()) return () => {};
  const el = document.createElement('div');
  el.className = `toy-overlay ${cls}`;
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  return () => el.remove();
}

function gainFor(volume: number) {
  const s = getSettings();
  return s.sounds ? volume * s.soundVolume : 0;
}

function playOnce(name: string, volume = 0.9) {
  void loadSfx(name).then((buf) => {
    if (!buf || !gainFor(volume)) return;
    const ctx = getAudioContext();
    const g = ctx.createGain();
    g.gain.value = gainFor(volume);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(g).connect(ctx.destination);
    src.start();
  });
}

function loopSound(name: string, volume = 0.8): Stop {
  let stopped = false;
  let src: AudioBufferSourceNode | null = null;
  let g: GainNode | null = null;
  void loadSfx(name).then((buf) => {
    if (stopped || !buf) return;
    const ctx = getAudioContext();
    g = ctx.createGain();
    g.gain.value = gainFor(volume);
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(g).connect(ctx.destination);
    src.start();
  });
  return () => {
    stopped = true;
    try {
      src?.stop();
    } catch {
      /* already stopped */
    }
    src?.disconnect();
    g?.disconnect();
  };
}

/** Things bouncing around the whole screen, DVD-logo style, spinning and tumbling. */
function bouncers(make: (size: number) => string, count = 16): Stop {
  if (!motionOk()) return () => {};
  const layer = document.createElement('div');
  layer.className = 'bounce-layer';
  layer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(layer);
  const w0 = window.innerWidth;
  const h0 = window.innerHeight;
  const items = Array.from({ length: count }, (_, i) => {
    const size = 46 + Math.random() * 48;
    const speed = 160 + Math.random() * 260;
    const a = Math.random() * Math.PI * 2;
    const el = document.createElement('div');
    el.className = 'bouncer';
    el.style.width = el.style.height = `${size}px`;
    el.style.animationDelay = `${i * 40}ms`;
    el.innerHTML = make(size);
    layer.appendChild(el);
    return {
      el,
      size,
      x: w0 / 2 - size / 2 + (Math.random() - 0.5) * 60,
      y: h0 / 2 - size / 2 + (Math.random() - 0.5) * 60,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      rot: Math.random() * 360,
      vrot: (Math.random() < 0.5 ? -1 : 1) * (120 + Math.random() * 300),
      flip: Math.random() * Math.PI,
      vflip: 2 + Math.random() * 4,
    };
  });
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const c of items) {
      c.x += c.vx * dt;
      c.y += c.vy * dt;
      if (c.x < 0) {
        c.x = 0;
        c.vx = Math.abs(c.vx);
        c.vrot = -c.vrot;
      } else if (c.x > w - c.size) {
        c.x = w - c.size;
        c.vx = -Math.abs(c.vx);
        c.vrot = -c.vrot;
      }
      if (c.y < 0) {
        c.y = 0;
        c.vy = Math.abs(c.vy);
      } else if (c.y > h - c.size) {
        c.y = h - c.size;
        c.vy = -Math.abs(c.vy);
      }
      c.rot += c.vrot * dt;
      c.flip += c.vflip * dt;
      const sy = 0.35 + 0.65 * Math.abs(Math.cos(c.flip));
      c.el.style.transform = `translate(${c.x}px, ${c.y}px) rotate(${c.rot}deg) scale(1, ${sy.toFixed(3)})`;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    layer.remove();
  };
}

/** A full-screen canvas redrawn every frame. */
function canvasLayer(cls: string, draw: (g: CanvasRenderingContext2D, w: number, h: number, dt: number) => void): Stop {
  if (!motionOk()) return () => {};
  const c = document.createElement('canvas');
  c.className = `toy-canvas ${cls}`;
  c.setAttribute('aria-hidden', 'true');
  document.body.appendChild(c);
  const g = c.getContext('2d')!;
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (c.width !== window.innerWidth || c.height !== window.innerHeight) {
      c.width = window.innerWidth;
      c.height = window.innerHeight;
    }
    draw(g, c.width, c.height, dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    c.remove();
  };
}

function snow(): Stop {
  const flakes = Array.from({ length: 160 }, () => ({
    x: Math.random(),
    y: Math.random(),
    r: 1 + Math.random() * 3.2,
    vy: 0.04 + Math.random() * 0.08,
    sway: Math.random() * Math.PI * 2,
  }));
  return canvasLayer('toy-snow', (g, w, h, dt) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    for (const f of flakes) {
      f.y += f.vy * dt;
      f.sway += dt * 1.4;
      if (f.y > 1.02) {
        f.y = -0.02;
        f.x = Math.random();
      }
      g.beginPath();
      g.arc(f.x * w + Math.sin(f.sway) * 18, f.y * h, f.r, 0, Math.PI * 2);
      g.fill();
    }
  });
}

function codeRain(): Stop {
  const glyphs = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789YAPAMEET';
  let drops: number[] = [];
  let acc = 0;
  return canvasLayer('toy-matrix', (g, w, h, dt) => {
    const size = 18;
    const cols = Math.ceil(w / size);
    if (drops.length !== cols) drops = Array.from({ length: cols }, () => Math.random() * -40);
    acc += dt;
    if (acc < 0.05) return;
    acc = 0;
    g.fillStyle = 'rgba(0, 0, 0, 0.09)';
    g.globalCompositeOperation = 'destination-out';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'source-over';
    g.font = `${size}px monospace`;
    for (let i = 0; i < cols; i++) {
      const y = drops[i] * size;
      g.fillStyle = Math.random() < 0.08 ? '#d1ffd6' : '#22ff55';
      g.fillText(glyphs[Math.floor(Math.random() * glyphs.length)], i * size, y);
      drops[i] = y > h && Math.random() > 0.975 ? 0 : drops[i] + 1;
    }
  });
}

const CRISP = (hue: number) => `
<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
  <defs><radialGradient id="cg${hue}" cx="40%" cy="35%" r="70%">
    <stop offset="0" stop-color="hsl(${hue} 95% 78%)"/><stop offset="0.55" stop-color="hsl(${hue - 4} 88% 60%)"/><stop offset="1" stop-color="hsl(${hue - 10} 80% 42%)"/>
  </radialGradient></defs>
  <path d="M50 6 C66 4 84 13 91 30 C98 46 95 60 88 72 C80 86 64 96 47 94 C30 92 14 84 8 68 C2 52 5 37 13 25 C22 12 36 7 50 6 Z" fill="url(#cg${hue})" stroke="hsl(${hue - 12} 70% 36%)" stroke-width="2"/>
  <path d="M20 40 C34 30 52 34 64 46 C74 56 82 58 90 56" fill="none" stroke="hsl(${hue - 12} 70% 40% / 0.45)" stroke-width="3" stroke-linecap="round"/>
  <path d="M14 60 C30 52 46 58 58 68 C68 76 78 78 86 74" fill="none" stroke="hsl(${hue - 12} 70% 40% / 0.35)" stroke-width="2.5" stroke-linecap="round"/>
  <circle cx="34" cy="28" r="3.2" fill="hsl(${hue - 14} 75% 34% / 0.55)"/><circle cx="68" cy="34" r="2.4" fill="hsl(${hue - 14} 75% 34% / 0.5)"/>
  <circle cx="58" cy="78" r="3" fill="hsl(${hue - 14} 75% 34% / 0.5)"/><circle cx="26" cy="72" r="2" fill="hsl(${hue - 14} 75% 34% / 0.45)"/>
  <ellipse cx="38" cy="24" rx="14" ry="6" fill="#fff" opacity="0.32" transform="rotate(-24 38 24)"/>
</svg>`;

const all = (...stops: Stop[]): Stop => () => stops.forEach((s) => s());

// ---------------------------------------------------------------- the toys

function startToy(id: ToyId): Stop {
  switch (id) {
    case 'evilflower':
      return all(htmlClass('toy-evilflower'), overlay('toy-red'), loopSound('egg-evilflower', 0.9));
    case 'chipparty':
      playOnce('fx-crunch');
      return bouncers(() => CRISP(38 + Math.round(Math.random() * 10)));
    case 'bananas':
      playOnce('toy-monkey');
      return bouncers((size) => `<span style="font-size:${Math.round(size * 0.85)}px">🍌</span>`, 14);
    case 'snowday':
      return all(snow(), overlay('toy-frost'), loopSound('toy-wind', 0.7));
    case 'rainyday':
      return all(overlay('toy-rain', true), htmlClass('toy-gloom'), loopSound('toy-rain', 0.7));
    case 'bighead':
      playOnce('sb-boing');
      return htmlClass('toy-bighead');
    case 'deepfried':
      return all(htmlClass('toy-deepfried'), loopSound('toy-sizzle', 0.85));
    case 'earthquake':
      return all(htmlClass('toy-earthquake', true), loopSound('toy-rumble', 0.8));
    case 'matrix':
      return all(codeRain(), htmlClass('toy-matrix'));
    case 'comicsans':
      return htmlClass('toy-comicsans');
    case 'australia':
      playOnce('sb-boing');
      return htmlClass('toy-australia');
    case 'dizzy':
      playOnce('toy-dizzy');
      return htmlClass('toy-dizzy', true);
    case 'tiny':
      playOnce('toy-swoosh');
      return htmlClass('toy-tiny');
    case 'opposite':
      playOnce('toy-bass');
      return htmlClass('toy-opposite');
    case 'underwater':
      return all(bubbles(), htmlClass('toy-underwater'), overlay('toy-sea'), loopSound('toy-underwater', 0.8));
    case 'meow': {
      playOnce('toy-meow');
      const cats = ['🐈', '🐱', '😺', '😸', '🙀', '😻'];
      return bouncers((size) => `<span style="font-size:${Math.round(size * 0.85)}px">${cats[Math.floor(Math.random() * cats.length)]}</span>`, 14);
    }
    case 'lightsout':
      playOnce('toy-switch');
      return flashlight();
    case 'rewind':
      playOnce('toy-rewind');
      return all(htmlClass('toy-rewind'), overlay('toy-vhs', true));
    case 'bomboclat':
      return all(htmlClass('toy-bomboclat', true), loopSound('egg-bomboclat', 0.85));
    default:
      return () => {};
  }
}

function bubbles(): Stop {
  const list = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: 3 + Math.random() * 9, vy: 0.05 + Math.random() * 0.12, w: Math.random() * 6 }));
  return canvasLayer('toy-bubbles', (g, w, h, dt) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(220, 245, 255, 0.75)';
    g.lineWidth = 1.5;
    for (const b of list) {
      b.y -= b.vy * dt;
      b.w += dt * 2;
      if (b.y < -0.05) {
        b.y = 1.05;
        b.x = Math.random();
      }
      const x = b.x * w + Math.sin(b.w) * 10;
      g.beginPath();
      g.arc(x, b.y * h, b.r, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(x - b.r * 0.35, b.y * h - b.r * 0.35, b.r * 0.25, 0, Math.PI * 2);
      g.stroke();
    }
  });
}

/** Lights Out: a dark screen with a hole that follows your mouse (or finger). */
function flashlight(): Stop {
  const el = document.createElement('div');
  el.className = 'toy-overlay toy-dark';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--fx', `${window.innerWidth / 2}px`);
  el.style.setProperty('--fy', `${window.innerHeight / 2}px`);
  document.body.appendChild(el);
  const move = (e: PointerEvent) => {
    el.style.setProperty('--fx', `${e.clientX}px`);
    el.style.setProperty('--fy', `${e.clientY}px`);
  };
  window.addEventListener('pointermove', move);
  return () => {
    window.removeEventListener('pointermove', move);
    el.remove();
  };
}

/** A few seconds of fireworks bursting across the screen. */
function fireworks() {
  if (!motionOk()) return;
  type P = { x: number; y: number; vx: number; vy: number; life: number; hue: number };
  const parts: P[] = [];
  let bursts = 0;
  const burst = (w: number, h: number) => {
    const x = w * (0.15 + Math.random() * 0.7);
    const y = h * (0.15 + Math.random() * 0.4);
    const hue = Math.floor(Math.random() * 360);
    for (let i = 0; i < 90; i++) {
      const a = (i / 90) * Math.PI * 2;
      const s = 120 + Math.random() * 220;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, hue: hue + Math.random() * 40 });
    }
  };
  let t = 0;
  const stop = canvasLayer('toy-fireworks', (g, w, h, dt) => {
    t += dt;
    if (bursts < 9 && t > bursts * 0.4) {
      burst(w, h);
      bursts++;
    }
    g.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 160 * dt;
      p.vx *= 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt * 0.55;
      if (p.life <= 0) continue;
      g.fillStyle = `hsla(${p.hue}, 95%, 62%, ${p.life})`;
      g.beginPath();
      g.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  });
  window.setTimeout(stop, 5500);
}

/** One-shot toys. `from` is the participant id that set it off (their tile is where it starts). */
export function fireToy(id: ToyId, from: string) {
  const tile = document.querySelector<HTMLElement>(`[data-pid="${CSS.escape(from)}"]`);
  const r = tile?.getBoundingClientRect();
  const at = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  const pop = (emoji: string, cls: string) => {
    const el = document.createElement('div');
    el.className = `toy-pop ${cls}`;
    el.textContent = emoji;
    el.style.left = `${at.x}px`;
    el.style.top = `${at.y}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2000);
  };
  const flash = (cls: string, ms: number, needsMotion = true) => {
    const stop = htmlClass(cls, needsMotion);
    window.setTimeout(stop, ms);
  };
  if (id === 'honk') {
    playOnce('toy-honk');
    pop('🤡', 'toy-pop-honk');
    flash('toy-squash', 600);
  } else if (id === 'gravity') {
    playOnce('toy-fall');
    flash('toy-gravity', 3300);
  } else if (id === 'fireworks') {
    playOnce('toy-fireworks');
    fireworks();
  } else if (id === 'encore') {
    playOnce('toy-cheer');
    fxBus.emit('confetti');
  } else if (id === 'yikes') {
    jumpscare();
  } else if (id === 'wow') {
    playOnce('toy-wow');
  } else if (id === 'whoopee') {
    playOnce('toy-fart');
    pop('💨', 'toy-pop-puff');
  }
}
