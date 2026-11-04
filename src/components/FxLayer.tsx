import { useEffect, useRef } from 'react';
import { fxBus } from '../lib/fx';
import { getSettings } from '../lib/settings';
import { sounds } from '../lib/sounds';

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  w: number;
  h: number;
  color: string;
  life: number;
}

const COLORS = ['#8b5cf6', '#3b82f6', '#ec4899', '#f59e0b', '#22c55e', '#06b6d4', '#f43f5e', '#fde047'];

/** Global overlay for confetti, plus the barrel-roll and party-mode classes. */
export function FxLayer() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pieces = useRef<Piece[]>([]);
  const raf = useRef(0);

  useEffect(() => {
    const burst = (count = 180) => {
      const c = canvas.current;
      if (!c) return;
      const w = (c.width = window.innerWidth);
      c.height = window.innerHeight;
      for (let i = 0; i < count; i++) {
        const fromLeft = i % 2 === 0;
        pieces.current.push({
          x: fromLeft ? -10 : w + 10,
          y: window.innerHeight * (0.55 + Math.random() * 0.3),
          vx: (fromLeft ? 1 : -1) * (6 + Math.random() * 9),
          vy: -(10 + Math.random() * 12),
          r: Math.random() * Math.PI,
          vr: (Math.random() - 0.5) * 0.4,
          w: 6 + Math.random() * 6,
          h: 8 + Math.random() * 10,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          life: 0,
        });
      }
      if (!raf.current) raf.current = requestAnimationFrame(tick);
    };
    const tick = () => {
      const c = canvas.current;
      const g = c?.getContext('2d');
      if (!c || !g) return;
      g.clearRect(0, 0, c.width, c.height);
      const list = pieces.current;
      for (const p of list) {
        p.vy += 0.35;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.r += p.vr;
        p.life++;
        g.save();
        g.translate(p.x, p.y);
        g.rotate(p.r);
        g.scale(1, Math.cos(p.life * 0.15));
        g.fillStyle = p.color;
        g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.restore();
      }
      pieces.current = list.filter((p) => p.y < c.height + 40 && p.life < 400);
      raf.current = pieces.current.length ? requestAnimationFrame(tick) : 0;
      if (!raf.current) g.clearRect(0, 0, c.width, c.height);
    };

    let rollTimer = 0;
    let partyTimer = 0;
    const off = fxBus.on((fx) => {
      if (getSettings().reduceMotion && fx !== 'confetti') return;
      const root = document.documentElement;
      if (fx === 'confetti') {
        burst();
        sounds.pop();
      } else if (fx === 'barrelroll') {
        root.classList.remove('fx-barrelroll');
        void root.offsetWidth; // restart the animation
        root.classList.add('fx-barrelroll');
        clearTimeout(rollTimer);
        rollTimer = window.setTimeout(() => root.classList.remove('fx-barrelroll'), 1700);
      } else if (fx === 'party') {
        root.classList.add('fx-party');
        sounds.party();
        burst(260);
        window.setTimeout(() => burst(200), 2500);
        clearTimeout(partyTimer);
        partyTimer = window.setTimeout(() => root.classList.remove('fx-party'), 9000);
      }
    });
    return () => {
      off();
      cancelAnimationFrame(raf.current);
      raf.current = 0;
      clearTimeout(rollTimer);
      clearTimeout(partyTimer);
    };
  }, []);

  return <canvas ref={canvas} className="fx-canvas" aria-hidden="true" />;
}
