import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link2, Play, Square, X } from 'lucide-react';
import type { WatchStore } from '../rtc/watch';
import { useEmitter } from '../lib/hooks';

/* Minimal typing for the YouTube IFrame API. */
interface YTPlayer {
  getCurrentTime(): number;
  getPlayerState(): number;
  seekTo(s: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
  getVideoData?: () => { title?: string };
}
interface YTNamespace {
  Player: new (
    el: HTMLElement,
    opts: {
      videoId: string;
      width?: string;
      height?: string;
      playerVars?: Record<string, number | string>;
      events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void };
    },
  ) => YTPlayer;
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytLoading: Promise<YTNamespace> | null = null;
function loadYouTube(): Promise<YTNamespace> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (!ytLoading) {
    ytLoading = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        prev?.();
        resolve(window.YT!);
      };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => {
        ytLoading = null;
        reject(new Error('YouTube player could not load'));
      };
      document.head.appendChild(s);
    });
  }
  return ytLoading;
}

/** Common surface over <video> and the YouTube player for the sync loop. */
interface Adapter {
  time(): number;
  /** Seconds, or 0 if unknown/endless. */
  duration(): number;
  paused(): boolean;
  seek(t: number): void;
  play(): Promise<void> | void;
  pause(): void;
  setRate?(r: number): void;
}

/**
 * Synced player. Local play/pause/seek is broadcast; remote state is applied with a
 * short "suppress echo" window so programmatic changes are not re-broadcast.
 */
export function WatchView({ store, onClose, strip, onChange }: { store: WatchStore; onClose: () => void; strip: ReactNode; onChange: () => void }) {
  useEmitter(store);
  const src = store.src;
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const adapter = useRef<Adapter | null>(null);
  /** Events we caused ourselves, so they are not mistaken for the user. */
  const pending = useRef({ play: 0, pause: 0, seek: 0, until: 0 });
  const [needsClick, setNeedsClick] = useState(false);
  const [error, setError] = useState('');
  const [drift, setDrift] = useState(0);

  const expect = (k: 'play' | 'pause' | 'seek') => {
    const p = pending.current;
    if (Date.now() > p.until) p.play = p.pause = p.seek = 0;
    p[k]++;
    p.until = Date.now() + 2500;
  };
  const consume = (k: 'play' | 'pause' | 'seek') => {
    const p = pending.current;
    if (Date.now() > p.until) {
      p.play = p.pause = p.seek = 0;
      return false;
    }
    if (p[k] > 0) {
      p[k]--;
      return true;
    }
    return false;
  };
  // Programmatic control (each expects exactly one matching player event).
  const doSeek = (a: Adapter, t: number) => {
    expect('seek');
    a.seek(t);
  };
  const doPlay = (a: Adapter) => {
    expect('play');
    return a.play();
  };
  const doPause = (a: Adapter) => {
    expect('pause');
    a.pause();
  };
  const userAction = (playing: boolean, t: number) => {
    // Ignore events that just confirm the shared state.
    if (playing === store.playing && Math.abs(t - store.expectedPos()) < 0.6) return;
    store.localAction(playing, t);
  };

  // File player wiring.
  useEffect(() => {
    if (src?.kind !== 'file') return;
    const v = videoRef.current;
    if (!v) return;
    setError('');
    adapter.current = {
      time: () => v.currentTime,
      duration: () => (Number.isFinite(v.duration) ? v.duration : 0),
      paused: () => v.paused,
      seek: (t) => {
        v.currentTime = t;
      },
      play: () =>
        v.play().then(
          () => setNeedsClick(false),
          (err: DOMException) => {
            if (err.name === 'NotAllowedError') setNeedsClick(true);
          },
        ),
      pause: () => v.pause(),
      setRate: (r) => {
        v.playbackRate = r;
      },
    };
    const onPlay = () => !consume('play') && userAction(true, v.currentTime);
    const onPause = () => !consume('pause') && !v.ended && userAction(false, v.currentTime);
    // The end pauses everyone at the end (instead of fighting to keep "playing").
    const onEnded = () => store.playing && store.localAction(false, v.currentTime);
    const onSeeked = () => !consume('seek') && userAction(!v.paused, v.currentTime);
    const onErr = () => setError("This video can't be played here. Use a direct .mp4/.webm link (catbox.moe, litterbox) or YouTube.");
    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('ended', onEnded);
    v.addEventListener('seeked', onSeeked);
    v.addEventListener('error', onErr);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('seeked', onSeeked);
      v.removeEventListener('error', onErr);
      adapter.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src?.kind === 'file' ? src.url : '']);

  // YouTube wiring.
  const ytId = src?.kind === 'youtube' ? src.id : '';
  useEffect(() => {
    if (!ytId || !ytHost.current) return;
    let player: YTPlayer | null = null;
    let cancelled = false;
    setError('');
    const mount = document.createElement('div');
    ytHost.current.appendChild(mount);
    loadYouTube()
      .then((YT) => {
        if (cancelled) return;
        player = new YT.Player(mount, {
          videoId: ytId,
          width: '100%',
          height: '100%',
          playerVars: { autoplay: 1, playsinline: 1, rel: 0, modestbranding: 1, start: Math.floor(store.expectedPos()) },
          events: {
            onReady: () => {
              const p = player!;
              adapter.current = {
                time: () => p.getCurrentTime(),
                duration: () => (p as YTPlayer & { getDuration?: () => number }).getDuration?.() || 0,
                paused: () => p.getPlayerState() !== 1 && p.getPlayerState() !== 3,
                seek: (t) => p.seekTo(t, true),
                play: () => p.playVideo(),
                pause: () => p.pauseVideo(),
              };
              const title = p.getVideoData?.().title;
              if (title) store.setTitle(title);
            },
            onStateChange: (e) => {
              if (!player) return;
              if (e.data === 1) {
                if (!consume('play') && !consume('seek')) userAction(true, player.getCurrentTime());
              } else if (e.data === 2) {
                if (!consume('pause')) userAction(false, player.getCurrentTime());
              }
              else if (e.data === 0 && store.playing) store.localAction(false, player.getCurrentTime());
            },
          },
        });
      })
      .catch((err: Error) => setError(err.message));
    return () => {
      cancelled = true;
      adapter.current = null;
      try {
        player?.destroy();
      } catch {
        /* ignore */
      }
      mount.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytId]);

  // Sync loop: match play state, correct drift (gentle speed change first, then seek).
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = adapter.current;
      if (!a || !store.src) return;
      const dur = a.duration();
      const want = dur ? Math.min(store.expectedPos(), dur) : store.expectedPos();
      // Past the end: everyone just stops at the end.
      if (dur && store.playing && want >= dur - 0.25) {
        if (a.paused()) store.localAction(false, dur);
        return;
      }
      if (store.playing && a.paused()) {
        doSeek(a, want);
        void doPlay(a);
      } else if (!store.playing && !a.paused()) {
        doPause(a);
        doSeek(a, want);
      }
      const d = a.time() - want;
      setDrift(d);
      const hard = store.src.kind === 'youtube' ? 1.2 : 0.9;
      if (Math.abs(d) > hard) {
        doSeek(a, want);
        a.setRate?.(1);
      } else if (a.setRate && store.playing) a.setRate(Math.abs(d) > 0.2 ? (d > 0 ? 0.94 : 1.06) : 1);
    }, 500);
    return () => clearInterval(t);
  }, [store]);

  if (!src) return null;
  return (
    <div className="stage-wrap watch-wrap" data-testid="watch-view" data-kind={src.kind}>
      <div className="stage stage-spotlight">
        <div className="spotlight-main watch-main">
          <div className="watch-bar">
            <span className="watch-title" title={src.title}>
              <Play size={14} /> {src.title}
            </span>
            <span className="watch-sync" title="How far your playback is from everyone else's" data-testid="watch-drift">
              {Math.abs(drift) < 0.5 ? 'In sync' : `${drift > 0 ? '+' : ''}${drift.toFixed(1)} s`}
            </span>
            <button className="btn btn-small btn-ghost" onClick={onChange} title="Change video">
              <Link2 size={14} /> Change
            </button>
            <button className="btn btn-small btn-ghost" onClick={() => store.stop()} title="Stop for everyone" data-testid="watch-stop">
              <Square size={14} /> Stop
            </button>
            <button className="icon-btn ghost" onClick={onClose} title="Back to videos (keeps playing for others)" aria-label="Close player" data-testid="watch-close">
              <X size={18} />
            </button>
          </div>
          <div className="watch-player">
            {src.kind === 'file' ? (
              <video ref={videoRef} src={src.url} controls playsInline autoPlay data-testid="watch-video" />
            ) : (
              <div ref={ytHost} className="yt-host" data-testid="watch-youtube" />
            )}
            {needsClick && (
              <button
                className="watch-click"
                onClick={() => {
                  const a = adapter.current;
                  if (!a) return;
                  doSeek(a, store.expectedPos());
                  void doPlay(a);
                }}
              >
                <Play size={22} /> Click to join playback
              </button>
            )}
            {error && <div className="watch-error">{error}</div>}
          </div>
        </div>
        <div className="spotlight-strip">{strip}</div>
      </div>
    </div>
  );
}
