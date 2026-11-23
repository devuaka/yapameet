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
  /** Mid-transition (YouTube buffering): neither playing nor paused yet, so leave it alone. */
  busy?(): boolean;
}

/**
 * Synced player. Local play/pause/seek is broadcast to everyone; remote state is applied
 * to the player. Commands we send to the player ourselves are remembered for a short
 * window, so the player's echo of them is not mistaken for the user, but anything that
 * does not match what we asked for (the user pressing play while we paused) still counts.
 */
export function WatchView({ store, onClose, strip, onChange }: { store: WatchStore; onClose: () => void; strip: ReactNode; onChange: () => void }) {
  useEmitter(store);
  const src = store.src;
  const videoRef = useRef<HTMLVideoElement>(null);
  const ytHost = useRef<HTMLDivElement>(null);
  const adapter = useRef<Adapter | null>(null);
  /** What we last told the player, and until when its echo is expected. */
  const ctl = useRef({ want: null as boolean | null, until: 0, seekUntil: 0, lastSeek: 0, playTries: 0, started: false });
  const [needsClick, setNeedsClick] = useState(false);
  const [error, setError] = useState('');
  const [drift, setDrift] = useState(0);

  /** True if a play/pause event is just the player confirming our own command. */
  const ours = (playing: boolean) => {
    const c = ctl.current;
    return Date.now() < c.until && c.want === playing;
  };
  const seeking = () => Date.now() < ctl.current.seekUntil;
  const doSeek = (a: Adapter, t: number) => {
    const c = ctl.current;
    c.seekUntil = Date.now() + 1500;
    c.lastSeek = Date.now();
    a.seek(t);
  };
  const doPlay = (a: Adapter) => {
    const c = ctl.current;
    c.want = true;
    c.until = Date.now() + 1500;
    return a.play();
  };
  const doPause = (a: Adapter) => {
    const c = ctl.current;
    c.want = false;
    c.until = Date.now() + 1500;
    a.pause();
  };
  const userAction = (playing: boolean, t: number) => {
    // Ignore events that just confirm the shared state.
    if (playing === store.playing && Math.abs(t - store.expectedPos()) < 1.5) return;
    store.localAction(playing, t);
  };
  /** A state report from an embedded player: 1 playing, 2 paused, 0 ended (YouTube/TikTok codes). */
  const onEmbedState = (code: number, t: number) => {
    if (code === 1) {
      const first = !ctl.current.started;
      ctl.current.started = true;
      ctl.current.playTries = 0;
      setNeedsClick(false);
      // Whoever started the video re-anchors the clock to when it actually began playing,
      // so the load time doesn't leave everyone "behind" by a second or two.
      if (first && store.leading && store.playing && Math.abs(t - store.expectedPos()) > 0.4) {
        store.localAction(true, t);
        return;
      }
      // Anyone else starting up late is just catching up (the sync loop seeks them), not a user action.
      if (first && !store.leading) return;
      if (ours(true) || (seeking() && store.playing)) return;
      userAction(true, t);
    } else if (code === 2) {
      // A video that never started (blocked autoplay, still loading) cannot be paused by a person.
      if (!ctl.current.started || ours(false) || (seeking() && !store.playing)) return;
      userAction(false, t);
    } else if (code === 0 && store.playing) {
      store.localAction(false, t);
    }
  };
  const resetForNewVideo = () => {
    ctl.current = { want: null, until: 0, seekUntil: 0, lastSeek: 0, playTries: 0, started: false };
    setNeedsClick(false);
  };

  // File player wiring.
  useEffect(() => {
    if (src?.kind !== 'file') return;
    const v = videoRef.current;
    if (!v) return;
    setError('');
    resetForNewVideo();
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
    const onPlay = () => {
      ctl.current.started = true;
      if (!ours(true)) userAction(true, v.currentTime);
    };
    const onPause = () => {
      if (ours(false) || v.ended || !ctl.current.started) return;
      userAction(false, v.currentTime);
    };
    // The end pauses everyone at the end (instead of fighting to keep "playing").
    const onEnded = () => store.playing && store.localAction(false, v.currentTime);
    const onSeeked = () => !seeking() && userAction(!v.paused, v.currentTime);
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
    resetForNewVideo();
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
                paused: () => p.getPlayerState() !== 1,
                // Buffering (3) is what both a user's play and a seek go through: wait for it to settle.
                busy: () => p.getPlayerState() === 3,
                seek: (t) => p.seekTo(t, true),
                play: () => p.playVideo(),
                pause: () => p.pauseVideo(),
              };
              const title = p.getVideoData?.().title;
              if (title) store.setTitle(title);
            },
            onStateChange: (e) => {
              if (player) onEmbedState(e.data, player.getCurrentTime());
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

  // TikTok wiring: the embed player (tiktok.com/player/v1) is driven by postMessage and reports its
  // state and time (about twice a second) the same way. It starts muted, so we unmute it once it plays.
  const ttId = src?.kind === 'tiktok' ? src.id : '';
  const ttFrame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const f = ttFrame.current;
    if (!ttId || !f) return;
    setError('');
    resetForNewVideo();
    const st = { state: -1, time: 0, at: Date.now(), dur: 0, muted: true, ready: false };
    const post = (type: string, value?: number) => f.contentWindow?.postMessage({ type, value, 'x-tiktok-player': true }, '*');
    const now = () => (st.state === 1 ? st.time + (Date.now() - st.at) / 1000 : st.time);
    const unmute = () => st.muted && post('unMute');
    const onMsg = (e: MessageEvent) => {
      if (e.source !== f.contentWindow || !/^https:\/\/(www\.)?tiktok\.com$/.test(e.origin)) return;
      const m = e.data as { type?: string; value?: unknown; 'x-tiktok-player'?: boolean };
      if (!m || typeof m !== 'object' || !m['x-tiktok-player']) return;
      if (m.type === 'onPlayerReady') {
        st.ready = true;
        adapter.current = {
          time: now,
          duration: () => st.dur,
          paused: () => st.state !== 1,
          busy: () => st.state === 3 || st.state === -1,
          seek: (t) => {
            st.time = t;
            st.at = Date.now();
            post('seekTo', t);
          },
          play: () => {
            post('play');
            unmute();
          },
          pause: () => post('pause'),
        };
      } else if (m.type === 'onStateChange' && typeof m.value === 'number') {
        const t = now();
        st.state = m.value;
        st.at = Date.now();
        st.time = t;
        if (m.value === 1) {
          unmute();
          setError('');
        }
        onEmbedState(m.value, t);
      } else if (m.type === 'onCurrentTime' && m.value && typeof m.value === 'object') {
        const v = m.value as { currentTime?: number; duration?: number };
        const t = Number(v.currentTime) || 0;
        // A jump nobody here asked for is the user scrubbing the progress bar.
        const jumped = st.ready && ctl.current.started && !seeking() && Math.abs(t - now()) > 1.5;
        st.time = t;
        st.at = Date.now();
        if (Number(v.duration) > 0) st.dur = Number(v.duration);
        if (jumped && !(st.dur && t >= st.dur - 0.5)) userAction(st.state === 1, t);
      } else if (m.type === 'onMute') {
        st.muted = !!m.value;
      } else if (m.type === 'onPlayerError') {
        const code = Number((m.value as { errorCode?: number })?.errorCode);
        if (code === 3002) setNeedsClick(true);
        else if (code === 1001) setError("This TikTok can't be embedded (private, removed, or a photo post).");
        else if (code) setError('TikTok could not play this video.');
      }
    };
    window.addEventListener('message', onMsg);
    return () => {
      window.removeEventListener('message', onMsg);
      adapter.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ttId]);

  // Sync loop: match play state, correct drift. YouTube can only jump (no fine speed control), so it
  // only re-seeks when it is clearly out of sync, and never more than once every few seconds.
  useEffect(() => {
    const t = window.setInterval(() => {
      const a = adapter.current;
      if (!a || !store.src) return;
      const c = ctl.current;
      const yt = store.src.kind !== 'file'; // embedded players can only jump, not change speed
      const now = Date.now();
      const dur = a.duration();
      const want = dur ? Math.min(store.expectedPos(), dur) : store.expectedPos();
      // Past the end: everyone just stops at the end.
      if (dur && store.playing && want >= dur - 0.25) {
        if (a.paused()) store.localAction(false, dur);
        return;
      }
      if (a.busy?.()) return;
      if (store.playing && a.paused()) {
        if (now < c.until && c.want === true) return; // just asked; give it a moment
        if (Math.abs(a.time() - want) > 1.5) doSeek(a, want);
        c.playTries++;
        // Still not playing after a few tries: the browser blocked autoplay; ask for one click.
        if (c.playTries >= 3) setNeedsClick(true);
        void doPlay(a);
        return;
      }
      if (!store.playing && !a.paused()) {
        if (now < c.until && c.want === false) return;
        doPause(a);
        if (Math.abs(a.time() - want) > 0.5) doSeek(a, want);
        return;
      }
      if (seeking()) return; // let a seek settle before measuring
      const d = a.time() - want;
      setDrift(d);
      if (!store.playing) {
        if (Math.abs(d) > 1.5 && now - c.lastSeek > 3000) doSeek(a, want);
        return;
      }
      if (yt) {
        if (Math.abs(d) > 1.2 && now - c.lastSeek > 8000) doSeek(a, want);
      } else if (Math.abs(d) > 1.2 && now - c.lastSeek > 2500) {
        doSeek(a, want);
        a.setRate?.(1);
      } else if (a.setRate) a.setRate(Math.abs(d) > 0.2 ? (d > 0 ? 0.94 : 1.06) : 1);
    }, 500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
            ) : src.kind === 'tiktok' ? (
              <iframe
                key={src.id}
                ref={ttFrame}
                className="tt-frame"
                title={src.title}
                src={`https://www.tiktok.com/player/v1/${src.id}?autoplay=1&rel=0&loop=0&music_info=1&description=1&native_context_menu=0`}
                allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
                allowFullScreen
                data-testid="watch-tiktok"
              />
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
