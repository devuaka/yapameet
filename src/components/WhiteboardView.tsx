import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Download, Eraser, Highlighter, Pencil, Trash2, Undo2, X } from 'lucide-react';
import { renderBoard, type WbTool, type WhiteboardStore } from '../rtc/whiteboard';
import { useEmitter } from '../lib/hooks';
import { downloadBlob } from '../rtc/captions';

const COLORS = ['#111827', '#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#ffffff'];
const SIZES = [3, 6, 12];
const BOARD_BG = '#fbfbfd';

export function WhiteboardView({ store, onClose, code, readOnly, banner }: { store: WhiteboardStore; onClose: () => void; code: string; readOnly?: boolean; banner?: React.ReactNode }) {
  useEmitter(store);
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [tool, setTool] = useState<WbTool>('pen');
  const [box, setBox] = useState({ w: 0, h: 0 });
  const drawing = useRef<{ id: string; last: [number, number] } | null>(null);

  useEffect(() => {
    store.setViewing(true);
    return () => store.setViewing(false);
  }, [store]);

  // Fit a 16:9 board into the available space.
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      const w = Math.min(width, (height * 16) / 9);
      setBox({ w: Math.floor(w), h: Math.floor((w * 9) / 16) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Redraw on any change (cheap: strokes are vector, the board is small).
  useEffect(() => {
    const c = canvas.current;
    if (!c || !box.w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== Math.round(box.w * dpr)) {
      c.width = Math.round(box.w * dpr);
      c.height = Math.round(box.h * dpr);
    }
    const id = requestAnimationFrame(() => renderBoard(c.getContext('2d')!, store.strokes.values(), c.width, c.height, BOARD_BG));
    return () => cancelAnimationFrame(id);
  }, [store.version, box, store]);

  const pos = (e: React.PointerEvent): [number, number] => {
    const r = canvas.current!.getBoundingClientRect();
    return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0 || readOnly) return;
    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      /* capture is a nicety (keeps the stroke when leaving the canvas) */
    }
    const p = pos(e);
    const id = store.begin(color, size, tool);
    store.addPoints(id, p);
    drawing.current = { id, last: p };
  };
  const move = (e: React.PointerEvent) => {
    const d = drawing.current;
    if (!d) return;
    const pts: number[] = [];
    const events = 'getCoalescedEvents' in e.nativeEvent ? (e.nativeEvent as PointerEvent).getCoalescedEvents() : [];
    const r = canvas.current!.getBoundingClientRect();
    for (const ev of events.length ? events : [e.nativeEvent as PointerEvent]) {
      const x = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      if (Math.hypot(x - d.last[0], y - d.last[1]) < 0.002) continue;
      pts.push(x, y);
      d.last = [x, y];
    }
    if (pts.length) store.addPoints(d.id, pts);
  };
  const up = () => {
    if (drawing.current) store.flush();
    drawing.current = null;
  };

  const save = () => {
    const c = document.createElement('canvas');
    c.width = 1920;
    c.height = 1080;
    renderBoard(c.getContext('2d')!, store.strokes.values(), 1920, 1080, BOARD_BG);
    c.toBlob((b) => b && downloadBlob(b, `yapameet-${code}-whiteboard.png`), 'image/png');
  };

  return (
    <div className="wb" data-testid="whiteboard">
      {banner}
      <div className={`wb-toolbar ${readOnly ? 'wb-readonly' : ''}`}>
        <div className="wb-group">
          <button className={tool === 'pen' ? 'sel' : ''} onClick={() => setTool('pen')} title="Pen" aria-label="Pen">
            <Pencil size={18} />
          </button>
          <button className={tool === 'highlighter' ? 'sel' : ''} onClick={() => setTool('highlighter')} title="Highlighter" aria-label="Highlighter">
            <Highlighter size={18} />
          </button>
          <button className={tool === 'eraser' ? 'sel' : ''} onClick={() => setTool('eraser')} title="Eraser" aria-label="Eraser">
            <Eraser size={18} />
          </button>
        </div>
        <div className="wb-group">
          {COLORS.map((c) => (
            <button
              key={c}
              className={`wb-color ${color === c && tool !== 'eraser' ? 'sel' : ''}`}
              style={{ background: c }}
              onClick={() => {
                setColor(c);
                if (tool === 'eraser') setTool('pen');
              }}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>
        <div className="wb-group">
          {SIZES.map((s) => (
            <button key={s} className={size === s ? 'sel' : ''} onClick={() => setSize(s)} aria-label={`Size ${s}`} title={`Size ${s}`}>
              <span className="wb-dot" style={{ width: s + 3, height: s + 3 }} />
            </button>
          ))}
        </div>
        <div className="wb-group">
          <button onClick={() => store.undo()} title="Undo my last stroke" aria-label="Undo">
            <Undo2 size={18} />
          </button>
          <button onClick={() => store.clear()} title="Clear the board for everyone" aria-label="Clear board" data-testid="wb-clear">
            <Trash2 size={18} />
          </button>
          <button onClick={save} title="Save as PNG" aria-label="Save as image">
            <Download size={18} />
          </button>
          <button onClick={onClose} title="Back to videos" aria-label="Close whiteboard" data-testid="wb-close">
            <X size={18} />
          </button>
        </div>
      </div>
      <div className="wb-area" ref={wrap}>
        <canvas
          ref={canvas}
          className="wb-canvas"
          style={{ width: box.w, height: box.h, cursor: readOnly ? 'default' : tool === 'eraser' ? 'cell' : 'crosshair' }}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          data-testid="wb-canvas"
        />
      </div>
    </div>
  );
}
