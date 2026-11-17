import { getSettings } from './settings';
import { getAudioContext, loadSfx } from './sounds';

/**
 * Secret game "Catch Ralsei" (type ralsei in Commands). On everyone's screen:
 * a "* CATCH ME" box and a jingle, then Ralsei dances around the screen to Rude
 * Buster while the screen pulses. The first person to click him wins: he explodes
 * for everyone. He gets bored and leaves after a while if nobody catches him.
 */
const GLYPHS: Record<string, string[]> = {
  '*': ['......', '..#...', '#.#.#.', '.###..', '#.#.#.', '..#...', '......'],
  C: ['.####.', '##..##', '##....', '##....', '##....', '##..##', '.####.'],
  A: ['.####.', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  T: ['######', '..##..', '..##..', '..##..', '..##..', '..##..', '..##..'],
  H: ['##..##', '##..##', '##..##', '######', '##..##', '##..##', '##..##'],
  M: ['##...##', '###.###', '#######', '##.#.##', '##...##', '##...##', '##...##'],
  E: ['######', '##....', '##....', '#####.', '##....', '##....', '######'],
  ' ': ['...', '...', '...', '...', '...', '...', '...'],
};

/** Pixel text as an SVG, drawn from the glyphs above (one unit = one pixel). */
function pixelText(text: string) {
  let x = 0;
  const rects: string[] = [];
  for (const ch of text) {
    const g = GLYPHS[ch] ?? GLYPHS[' '];
    g.forEach((row, y) => [...row].forEach((c, i) => c === '#' && rects.push(`<rect x="${x + i}" y="${y}" width="1.02" height="1.02"/>`)));
    x += g[0].length + 1;
  }
  return `<svg viewBox="0 0 ${x - 1} 7" shape-rendering="crispEdges" fill="#fff" xmlns="http://www.w3.org/2000/svg">${rects.join('')}</svg>`;
}

const IMG = `${import.meta.env.BASE_URL}eggs/ralsei.png`;
const BOOM = `${import.meta.env.BASE_URL}eggs/boom-sheet.png`;
const JINGLE_MS = 3100;
const MAX_MS = 45_000;

let running = false;
let cleanup: (() => void) | null = null;
let catchHandler: (() => void) | null = null;
let ralseiEl: HTMLDivElement | null = null;

export const ralseiRunning = () => running;

function sound(name: string, volume: number, loop = false) {
  let stopped = false;
  let src: AudioBufferSourceNode | null = null;
  void loadSfx(name).then((buf) => {
    const s = getSettings();
    if (stopped || !buf || !s.sounds) return;
    const ctx = getAudioContext();
    const g = ctx.createGain();
    g.gain.value = volume * s.soundVolume;
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = loop;
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
  };
}

function explodeAt(x: number, y: number) {
  const el = document.createElement('div');
  el.className = 'ralsei-boom';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.style.backgroundImage = `url(${BOOM})`;
  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 1800);
  sound('egg-ralsei-boom', 1);
}

/** Start the game on this screen. `onCatch` runs when *this* person clicks Ralsei first. */
export function startRalsei(onCatch: () => void) {
  if (running) return;
  running = true;
  catchHandler = onCatch;
  const timers: number[] = [];
  const stops: (() => void)[] = [];

  // 1. "* CATCH ME" in a dark-world dialogue box, with the jingle.
  const box = document.createElement('div');
  box.className = 'ralsei-box';
  box.innerHTML = pixelText('* CATCH ME');
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', 'Catch me');
  document.body.appendChild(box);
  stops.push(sound('egg-ralsei-jingle', 0.9));
  stops.push(() => box.remove());

  timers.push(
    window.setTimeout(() => {
      box.classList.add('leaving');
      // 2. Ralsei dances around the screen to Rude Buster; the screen pulses.
      stops.push(sound('egg-ralsei-music', 0.75, true));
      if (!getSettings().reduceMotion) {
        const pulse = document.createElement('div');
        pulse.className = 'ralsei-pulse';
        pulse.setAttribute('aria-hidden', 'true');
        document.body.appendChild(pulse);
        const beat = window.setInterval(() => {
          pulse.style.background = `hsl(${Math.floor(Math.random() * 360)} 90% 55%)`;
          pulse.classList.remove('hit');
          void pulse.offsetWidth;
          pulse.classList.add('hit');
        }, 430);
        stops.push(() => {
          clearInterval(beat);
          pulse.remove();
        });
      }
      const r = document.createElement('div');
      r.className = 'ralsei';
      r.setAttribute('role', 'button');
      r.setAttribute('aria-label', 'Catch Ralsei');
      r.dataset.testid = 'ralsei';
      r.innerHTML = `<img src="${IMG}" alt="" draggable="false" />`;
      document.body.appendChild(r);
      ralseiEl = r;
      const size = { w: 78, h: 150 };
      let x = Math.random() * (window.innerWidth - size.w);
      let y = Math.random() * (window.innerHeight - size.h);
      let a = Math.random() * Math.PI * 2;
      let speed = 340;
      let last = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        // Wanders like he is dancing away from the cursor: random turns, speeds up over time.
        a += (Math.random() - 0.5) * 3.2 * dt;
        speed = Math.min(620, speed + 6 * dt);
        x += Math.cos(a) * speed * dt;
        y += Math.sin(a) * speed * dt;
        const W = window.innerWidth - size.w;
        const H = window.innerHeight - size.h;
        if (x < 0 || x > W) {
          a = Math.PI - a;
          x = Math.max(0, Math.min(W, x));
        }
        if (y < 0 || y > H) {
          a = -a;
          y = Math.max(0, Math.min(H, y));
        }
        r.style.transform = `translate(${x}px, ${y}px)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      stops.push(() => {
        cancelAnimationFrame(raf);
        r.remove();
        ralseiEl = null;
      });
      r.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        catchHandler?.();
        catchRalsei();
      });
    }, JINGLE_MS),
  );

  // 3. Nobody caught him: he gets bored and wanders off.
  timers.push(
    window.setTimeout(() => {
      if (!ralseiEl) return endRalsei();
      ralseiEl.classList.add('bored');
      window.setTimeout(endRalsei, 600);
    }, MAX_MS),
  );

  cleanup = () => {
    timers.forEach(clearTimeout);
    stops.forEach((s) => s());
  };
}

/** He was caught (here, or by someone else): explode where he is on this screen. */
export function catchRalsei() {
  if (!running) return;
  const r = ralseiEl?.getBoundingClientRect();
  if (r) explodeAt(r.left + r.width / 2, r.top + r.height / 2);
  endRalsei();
}

export function endRalsei() {
  running = false;
  catchHandler = null;
  cleanup?.();
  cleanup = null;
}
