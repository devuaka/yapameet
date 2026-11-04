import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { Participant } from '../rtc/MeetingSession';
import { VideoTile, type Tile } from './VideoTile';

const GAP = 10;
const ASPECT = 16 / 9;

/** Pick the column count that makes 16:9 tiles as large as possible in the box. */
function bestGrid(n: number, w: number, h: number) {
  let best = { cols: 1, tw: 0, th: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cw = (w - GAP * (cols - 1)) / cols;
    const ch = (h - GAP * (rows - 1)) / rows;
    const tw = Math.min(cw, ch * ASPECT);
    if (tw > best.tw) best = { cols, tw, th: tw / ASPECT };
  }
  return best;
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

export function VideoGrid({
  participants,
  pinned,
  onPin,
  mirrorSelf,
  showDetails,
}: {
  participants: Participant[];
  pinned: string | null;
  onPin: (key: string | null) => void;
  mirrorSelf: boolean;
  showDetails: boolean;
}) {
  const tiles = useMemo(() => {
    const list: Tile[] = [];
    for (const p of participants) {
      list.push({ key: `${p.id}:cam`, kind: 'cam', p });
      if (p.screen) list.push({ key: `${p.id}:screen`, kind: 'screen', p });
    }
    return list;
  }, [participants]);

  // Spotlight: a pinned tile, otherwise someone else's screen share.
  const spotlight =
    tiles.find((t) => t.key === pinned) ?? tiles.find((t) => t.kind === 'screen' && !t.p.isLocal) ?? null;

  const [ref, size] = useSize<HTMLDivElement>();
  const common = { onPin, mirrorSelf, showDetails };

  if (spotlight) {
    const rest = tiles.filter((t) => t !== spotlight);
    return (
      <div className="stage-wrap" ref={ref}><div className="stage stage-spotlight">
        <div className="spotlight-main">
          <VideoTile tile={spotlight} pinned={spotlight.key === pinned} {...common} />
        </div>
        {rest.length > 0 && (
          <div className="spotlight-strip">
            {rest.map((t) => (
              <VideoTile key={t.key} tile={t} pinned={t.key === pinned} compact {...common} />
            ))}
          </div>
        )}
      </div></div>
    );
  }

  // One-on-one: the other person fills the stage, you float in the corner.
  const localCam = tiles.find((t) => t.p.isLocal && t.kind === 'cam');
  if (tiles.length === 2 && localCam) {
    const other = tiles.find((t) => t !== localCam)!;
    return (
      <div className="stage-wrap" ref={ref}><div className="stage stage-duo">
        <VideoTile tile={other} pinned={false} {...common} />
        <div className="self-float">
          <VideoTile tile={localCam} pinned={false} compact {...common} />
        </div>
      </div></div>
    );
  }

  const { tw, th } = bestGrid(tiles.length, size.w, size.h);
  return (
    <div className="stage-wrap" ref={ref}><div className="stage stage-grid">
      {size.w > 0 &&
        tiles.map((t) => (
          <VideoTile key={t.key} tile={t} pinned={t.key === pinned} style={{ width: tw, height: th }} compact={tw < 260} {...common} />
        ))}
      {tiles.length === 1 && <div className="alone-hint">You're the only one here. Share the link to invite people.</div>}
    </div></div>
  );
}
