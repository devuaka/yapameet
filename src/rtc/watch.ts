import { Emitter } from '../lib/emitter';
import type { MeetingSession, SessionEvent } from './MeetingSession';

export type WatchSource = { kind: 'youtube'; id: string; title: string } | { kind: 'file'; url: string; title: string };

type WatchMsg =
  | { op: 'load'; src: WatchSource; pos: number; playing: boolean }
  | { op: 'state'; pos: number; playing: boolean }
  | { op: 'stop' };

const FILE_HOSTS = /(^|\.)catbox\.moe$/i; // files.catbox.moe and litter.catbox.moe (Litterbox)
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|ogg|mp3|m4a|wav)(\?|#|$)/i;

/** Turn a pasted link into something we can play in sync, or null. */
export function parseWatchUrl(input: string): WatchSource | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\.|^m\.|^music\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = url.pathname.slice(1);
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    yt = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:shorts|embed|live|v)\/([^/?#]+)/)?.[1] ?? null;
  }
  if (yt) {
    const id = yt.match(/^[A-Za-z0-9_-]{11}/)?.[0];
    return id ? { kind: 'youtube', id, title: 'YouTube video' } : null;
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
  if (FILE_HOSTS.test(url.hostname) || VIDEO_EXT.test(url.pathname) || local) {
    const name = decodeURIComponent(url.pathname.split('/').pop() || 'Video');
    return { kind: 'file', url: url.href, title: name.slice(0, 80) };
  }
  return null;
}

/**
 * Watch together. State is "position at a moment + playing/paused"; whoever acts
 * broadcasts, and the last person who acted re-broadcasts every 4 s so drift gets
 * corrected. Newcomers receive the current video and position.
 */
export class WatchStore extends Emitter {
  src: WatchSource | null = null;
  playing = false;
  /** Position (s) at refTime. */
  private pos = 0;
  private refTime = 0;
  startedBy = '';
  lastActor = '';
  /** True when we were the last to act (we keep everyone in sync). */
  leading = false;
  version = 0;
  onRemoteLoad: ((src: WatchSource, by: string) => void) | null = null;
  private heartbeat: number;
  private off: () => void;

  constructor(private session: MeetingSession) {
    super();
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'watch') this.apply(e.data as WatchMsg, e.name);
      else if (e.type === 'peer-ready' && this.src) {
        this.session.sendApp('watch', { op: 'load', src: this.src, pos: this.expectedPos(), playing: this.playing } satisfies WatchMsg, e.from);
      }
    });
    (window as unknown as { __yapameetWatch?: WatchStore }).__yapameetWatch = this; // debug/test hook
    this.heartbeat = window.setInterval(() => {
      if (this.src && this.leading && this.playing) this.broadcastState();
    }, 4000);
  }

  dispose() {
    this.off();
    clearInterval(this.heartbeat);
  }

  expectedPos(): number {
    return this.playing ? this.pos + (Date.now() - this.refTime) / 1000 : this.pos;
  }

  private bump() {
    this.version++;
    this.emit();
  }

  private set(pos: number, playing: boolean) {
    this.pos = Math.max(0, pos);
    this.playing = playing;
    this.refTime = Date.now();
  }

  load(src: WatchSource) {
    this.src = src;
    this.startedBy = 'You';
    this.lastActor = 'You';
    this.leading = true;
    this.set(0, true);
    this.session.sendApp('watch', { op: 'load', src, pos: 0, playing: true } satisfies WatchMsg);
    this.bump();
  }

  /** The local user pressed play/pause or seeked. */
  localAction(playing: boolean, pos: number) {
    if (!this.src) return;
    this.set(pos, playing);
    this.leading = true;
    this.lastActor = 'You';
    this.broadcastState();
    this.bump();
  }

  /** The player learned the real title (YouTube). */
  setTitle(title: string) {
    if (this.src && title && this.src.title !== title) {
      this.src = { ...this.src, title: title.slice(0, 120) };
      this.bump();
    }
  }

  stop() {
    this.src = null;
    this.leading = false;
    this.session.sendApp('watch', { op: 'stop' } satisfies WatchMsg);
    this.bump();
  }

  private broadcastState() {
    this.session.sendApp('watch', { op: 'state', pos: this.expectedPos(), playing: this.playing } satisfies WatchMsg);
  }

  private apply(m: WatchMsg, name: string) {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'load' && m.src) {
      const src = m.src.kind === 'youtube' ? parseWatchUrl(`https://youtu.be/${m.src.id}`) : parseWatchUrl(m.src.url);
      if (!src) return; // never play something that doesn't pass our own validation
      const same = this.src && JSON.stringify({ ...this.src, title: '' }) === JSON.stringify({ ...src, title: '' });
      this.src = { ...src, title: String(m.src.title || src.title).slice(0, 120) };
      this.startedBy = name;
      this.lastActor = name;
      this.leading = false;
      this.set(Number(m.pos) || 0, !!m.playing);
      if (!same) this.onRemoteLoad?.(this.src, name);
    } else if (m.op === 'state' && this.src) {
      this.set(Number(m.pos) || 0, !!m.playing);
      this.lastActor = name;
      this.leading = false;
    } else if (m.op === 'stop') {
      this.src = null;
      this.leading = false;
    } else return;
    this.bump();
  }
}
