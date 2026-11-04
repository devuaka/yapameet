import { Emitter } from '../lib/emitter';
import { randomId } from '../lib/crypto';
import type { MeetingSession, SessionEvent } from './MeetingSession';

export type WbTool = 'pen' | 'highlighter' | 'eraser';

export interface Stroke {
  id: string;
  by: string;
  color: string;
  size: number;
  tool: WbTool;
  /** Flat [x0, y0, x1, y1, ...] in 0..1 board coordinates. */
  pts: number[];
}

type WbMsg =
  | { op: 'pts'; id: string; color: string; size: number; tool: WbTool; pts: number[] }
  | { op: 'del'; id: string }
  | { op: 'clear' }
  | { op: 'snap'; strokes: Stroke[] };

/**
 * Shared whiteboard state. Points stream peer-to-peer every 40 ms while you draw;
 * whoever is already in the call sends the full board to newcomers.
 */
export class WhiteboardStore extends Emitter {
  strokes = new Map<string, Stroke>();
  version = 0;
  /** Remote changes since you last looked at the board. */
  unseen = 0;
  lastDrawer = '';
  viewing = false;
  private mine: string[] = [];
  private pending = new Map<string, number[]>();
  private flushTimer: number | null = null;
  private off: () => void;

  constructor(private session: MeetingSession) {
    super();
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'wb') this.apply(e.data as WbMsg, e.from, e.name);
      else if (e.type === 'peer-ready') this.sendSnapshot(e.from);
    });
  }

  dispose() {
    this.off();
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }

  setViewing(v: boolean) {
    this.viewing = v;
    if (v) this.unseen = 0;
    this.bump();
  }

  private bump() {
    this.version++;
    this.emit();
  }

  begin(color: string, size: number, tool: WbTool): string {
    const id = randomId(6);
    this.strokes.set(id, { id, by: this.session.selfId, color, size, tool, pts: [] });
    this.mine.push(id);
    return id;
  }

  addPoints(id: string, pts: number[]) {
    const s = this.strokes.get(id);
    if (!s) return;
    const rounded = pts.map((v) => Math.round(v * 10000) / 10000);
    s.pts.push(...rounded);
    const p = this.pending.get(id) ?? [];
    p.push(...rounded);
    this.pending.set(id, p);
    if (!this.flushTimer) this.flushTimer = window.setTimeout(() => this.flush(), 40);
    this.bump();
  }

  flush() {
    this.flushTimer = null;
    for (const [id, pts] of this.pending) {
      const s = this.strokes.get(id);
      if (s && pts.length) this.session.sendApp('wb', { op: 'pts', id, color: s.color, size: s.size, tool: s.tool, pts } satisfies WbMsg);
    }
    this.pending.clear();
  }

  undo() {
    const id = this.mine.pop();
    if (!id) return;
    this.flush();
    this.strokes.delete(id);
    this.session.sendApp('wb', { op: 'del', id } satisfies WbMsg);
    this.bump();
  }

  clear() {
    this.strokes.clear();
    this.mine = [];
    this.session.sendApp('wb', { op: 'clear' } satisfies WbMsg);
    this.bump();
  }

  private sendSnapshot(to: string) {
    if (!this.strokes.size) return;
    const all = [...this.strokes.values()];
    for (let i = 0; i < all.length; i += 40) this.session.sendApp('wb', { op: 'snap', strokes: all.slice(i, i + 40) } satisfies WbMsg, to);
  }

  private apply(m: WbMsg, from: string, name: string) {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'pts' && Array.isArray(m.pts)) {
      let s = this.strokes.get(m.id);
      if (!s) {
        s = { id: m.id, by: from, color: String(m.color).slice(0, 20), size: Math.min(60, Number(m.size) || 4), tool: m.tool, pts: [] };
        this.strokes.set(m.id, s);
      }
      s.pts.push(...m.pts.filter((v) => typeof v === 'number'));
      this.lastDrawer = name;
      if (!this.viewing) this.unseen++;
    } else if (m.op === 'del') {
      this.strokes.delete(m.id);
    } else if (m.op === 'clear') {
      this.strokes.clear();
      this.mine = [];
    } else if (m.op === 'snap' && Array.isArray(m.strokes)) {
      for (const s of m.strokes) if (s?.id && !this.strokes.has(s.id) && Array.isArray(s.pts)) this.strokes.set(s.id, s);
    } else return;
    this.bump();
  }
}

/** Draw every stroke onto a canvas (board coordinates scaled to the canvas size). */
export function renderBoard(ctx: CanvasRenderingContext2D, strokes: Iterable<Stroke>, w: number, h: number, bg: string) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  for (const s of strokes) {
    if (s.pts.length < 2) continue;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.size * (w / 1000) * (s.tool === 'highlighter' ? 3 : s.tool === 'eraser' ? 4 : 1);
    ctx.strokeStyle = s.tool === 'eraser' ? bg : s.color;
    ctx.globalAlpha = s.tool === 'highlighter' ? 0.35 : 1;
    ctx.beginPath();
    ctx.moveTo(s.pts[0] * w, s.pts[1] * h);
    if (s.pts.length === 2) ctx.lineTo(s.pts[0] * w + 0.01, s.pts[1] * h);
    for (let i = 2; i < s.pts.length - 2; i += 2) {
      const mx = ((s.pts[i] + s.pts[i + 2]) / 2) * w;
      const my = ((s.pts[i + 1] + s.pts[i + 3]) / 2) * h;
      ctx.quadraticCurveTo(s.pts[i] * w, s.pts[i + 1] * h, mx, my);
    }
    if (s.pts.length >= 4) ctx.lineTo(s.pts[s.pts.length - 2] * w, s.pts[s.pts.length - 1] * h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
