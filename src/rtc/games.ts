import { Emitter } from '../lib/emitter';
import { randomId } from '../lib/crypto';
import { drawWordList } from '../lib/gameContent';
import type { MeetingSession, SessionEvent } from './MeetingSession';

// ================================================================ Draw & Guess

type DGMsg =
  | { op: 'start'; host: string; order: string[] }
  | { op: 'round'; n: number; total: number; drawer: string; hint: string; remaining: number; scores: Record<string, number> }
  | { op: 'word'; word: string }
  | { op: 'hint'; hint: string }
  | { op: 'guess'; text: string }
  | { op: 'skip' }
  | { op: 'guessed'; who: string; ok: boolean; text?: string; points?: number }
  | { op: 'reveal'; word: string; scores: Record<string, number> }
  | { op: 'end'; scores: Record<string, number>; reason?: string };

const ROUND_MS = 80_000;
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[^a-z]/g, '');

export interface FeedItem {
  id: number;
  name: string;
  text: string;
  ok: boolean;
}

/**
 * Draw & Guess. The person who starts the game is the host: they pick words,
 * judge guesses and keep score. Guesses go privately to the host, so a correct
 * answer is never shown to anyone. Drawing happens on the shared whiteboard.
 */
export class DrawGuessStore extends Emitter {
  active = false;
  phase: 'drawing' | 'reveal' | 'over' = 'drawing';
  host = '';
  round = 0;
  total = 0;
  drawer = '';
  /** The secret word: shown only to the drawer, then to everyone at round end (the host judges privately). */
  word = '';
  hint = '';
  endsAt = 0;
  scores: Record<string, number> = {};
  guessed = new Set<string>();
  feed: FeedItem[] = [];
  version = 0;
  onRoundStart: ((drawerIsMe: boolean) => void) | null = null;
  onEvent: ((e: { kind: 'correct' | 'wrong' | 'reveal' | 'end'; who?: string }) => void) | null = null;
  /** Called by the host to wipe the whiteboard at the start of each round. */
  clearBoard: (() => void) | null = null;

  // host-only state
  private order: string[] = [];
  private used = new Set<string>();
  private hostWord = '';
  private timers: number[] = [];
  private feedId = 0;
  private off: () => void;

  constructor(private session: MeetingSession) {
    super();
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'dg') this.apply(e.data as DGMsg, e.from);
      else if (e.type === 'peer-ready' && this.isHost && this.active) {
        // Bring a newcomer into the running game.
        this.session.sendApp('dg', { op: 'start', host: this.host, order: this.order } satisfies DGMsg, e.from);
        if (this.phase === 'drawing') {
          this.session.sendApp(
            'dg',
            { op: 'round', n: this.round, total: this.total, drawer: this.drawer, hint: this.hint, remaining: this.endsAt - Date.now(), scores: this.scores } satisfies DGMsg,
            e.from,
          );
        }
      }
    });
  }

  get me() {
    return this.session.selfId;
  }
  get isHost() {
    return this.host === this.me;
  }
  get isDrawer() {
    return this.active && this.drawer === this.me && this.phase === 'drawing';
  }

  dispose() {
    this.off();
    this.clearTimers();
  }

  private bump() {
    this.version++;
    this.emit();
  }

  private clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  private nameOf(id: string) {
    return this.session.getSnapshot().participants.find((p) => p.id === id)?.name ?? 'Someone';
  }

  // ---------------------------------------------------------------- host

  start() {
    const people = this.session.getSnapshot().participants.filter((p) => !p.leaving && !p.bot);
    if (people.length < 2) return false;
    this.order = people.map((p) => p.id).slice(0, 8);
    this.used.clear();
    this.broadcast({ op: 'start', host: this.me, order: this.order });
    this.scores = Object.fromEntries(this.order.map((id) => [id, 0]));
    this.nextRound(0);
    return true;
  }

  private broadcast(m: DGMsg) {
    this.session.sendApp('dg', m);
    this.apply(m, this.me);
  }

  private pickWord() {
    const list = drawWordList().filter((w) => !this.used.has(w));
    const w = list[Math.floor(Math.random() * list.length)] ?? 'cat';
    this.used.add(w);
    return w;
  }

  private nextRound(n: number) {
    this.clearTimers();
    const present = new Set(this.session.getSnapshot().participants.map((p) => p.id));
    while (n < this.order.length && !present.has(this.order[n])) n++;
    if (n >= this.order.length) {
      this.broadcast({ op: 'end', scores: this.scores });
      return;
    }
    const drawer = this.order[n];
    this.hostWord = this.pickWord();
    this.clearBoard?.();
    const hint = this.hostWord.replace(/[a-z]/gi, '_');
    this.broadcast({ op: 'round', n: n + 1, total: this.order.length, drawer, hint, remaining: ROUND_MS, scores: this.scores });
    if (drawer === this.me) this.word = this.hostWord;
    else this.session.sendApp('dg', { op: 'word', word: this.hostWord } satisfies DGMsg, drawer);
    this.bump();
    this.timers.push(
      window.setTimeout(() => this.revealLetter(), ROUND_MS / 2),
      window.setTimeout(() => this.reveal(), ROUND_MS),
    );
  }

  private revealLetter() {
    const letters = [...this.hostWord].map((ch, i) => (/[a-z]/i.test(ch) && this.hint[i] === '_' ? i : -1)).filter((i) => i >= 0);
    if (letters.length < 2) return;
    const i = letters[Math.floor(Math.random() * letters.length)];
    const hint = [...this.hint].map((ch, j) => (j === i ? this.hostWord[i] : ch)).join('');
    this.broadcast({ op: 'hint', hint });
  }

  private reveal() {
    this.clearTimers();
    this.broadcast({ op: 'reveal', word: this.hostWord, scores: this.scores });
    this.timers.push(window.setTimeout(() => this.nextRound(this.round), 4500));
  }

  private judge(from: string, text: string) {
    if (!this.isHost || this.phase !== 'drawing' || from === this.drawer || this.guessed.has(from)) return;
    const g = norm(text);
    const w = norm(this.hostWord);
    if (!g) return;
    if (g === w || g === `${w}s` || `${g}s` === w) {
      const secs = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
      const points = 50 + secs * 2;
      this.scores = { ...this.scores, [from]: (this.scores[from] ?? 0) + points, [this.drawer]: (this.scores[this.drawer] ?? 0) + 25 };
      this.broadcast({ op: 'guessed', who: from, ok: true, points });
      const guessers = this.order.filter((id) => id !== this.drawer && this.session.getSnapshot().participants.some((p) => p.id === id));
      if (guessers.every((id) => this.guessed.has(id))) this.reveal();
    } else {
      this.broadcast({ op: 'guessed', who: from, ok: false, text: text.slice(0, 60) });
    }
  }

  stop() {
    if (this.isHost) this.broadcast({ op: 'end', scores: this.scores, reason: 'stopped' });
  }

  // ---------------------------------------------------------------- players

  guess(text: string) {
    if (!this.active || this.phase !== 'drawing' || this.isDrawer || !text.trim()) return;
    if (this.isHost) this.judge(this.me, text);
    else this.session.sendApp('dg', { op: 'guess', text: text.slice(0, 60) } satisfies DGMsg, this.host);
  }

  skip() {
    if (!this.isDrawer) return;
    if (this.isHost) this.reveal();
    else this.session.sendApp('dg', { op: 'skip' } satisfies DGMsg, this.host);
  }

  /** End the game if its host left the call. */
  checkHost() {
    if (this.active && !this.isHost && !this.session.getSnapshot().participants.some((p) => p.id === this.host)) {
      this.apply({ op: 'end', scores: this.scores, reason: 'host left' }, this.host);
    }
  }

  private addFeed(name: string, text: string, ok: boolean) {
    this.feed = [...this.feed.slice(-30), { id: ++this.feedId, name, text, ok }];
  }

  private apply(m: DGMsg, from: string) {
    if (!m || typeof m !== 'object') return;
    switch (m.op) {
      case 'start':
        this.clearTimers();
        this.active = true;
        this.host = m.host;
        this.order = m.order;
        this.feed = [];
        this.phase = 'drawing';
        break;
      case 'round':
        if (from !== this.host) return;
        this.active = true;
        this.phase = 'drawing';
        this.round = m.n;
        this.total = m.total;
        this.drawer = m.drawer;
        this.hint = m.hint;
        this.endsAt = Date.now() + m.remaining;
        this.scores = m.scores;
        this.guessed = new Set();
        if (!this.isHost) this.word = '';
        this.addFeed('', `Round ${m.n}/${m.total}: ${this.nameOf(m.drawer)} is drawing`, false);
        this.onRoundStart?.(m.drawer === this.me);
        break;
      case 'word':
        if (from !== this.host) return;
        this.word = m.word;
        break;
      case 'hint':
        if (from !== this.host) return;
        this.hint = m.hint;
        break;
      case 'guess':
        this.judge(from, m.text);
        return;
      case 'skip':
        if (this.isHost && from === this.drawer) this.reveal();
        return;
      case 'guessed':
        if (from !== this.host) return;
        if (m.ok) {
          this.guessed.add(m.who);
          this.addFeed(this.nameOf(m.who), `guessed it! +${m.points}`, true);
          this.onEvent?.({ kind: 'correct', who: m.who });
        } else {
          this.addFeed(this.nameOf(m.who), m.text ?? '', false);
          if (m.who === this.me) this.onEvent?.({ kind: 'wrong' });
        }
        break;
      case 'reveal':
        if (from !== this.host) return;
        this.phase = 'reveal';
        this.word = m.word;
        this.scores = m.scores;
        this.addFeed('', `The word was "${m.word}"`, false);
        this.onEvent?.({ kind: 'reveal' });
        break;
      case 'end':
        if (from !== this.host) return;
        this.clearTimers();
        this.phase = 'over';
        this.scores = m.scores;
        this.onEvent?.({ kind: 'end' });
        this.timers.push(
          window.setTimeout(() => {
            this.active = false;
            this.bump();
          }, 9000),
        );
        if (m.reason) this.addFeed('', `Game ${m.reason === 'stopped' ? 'stopped' : 'ended: ' + m.reason}`, false);
        break;
    }
    this.bump();
  }

  /** Scores sorted high to low, with names. */
  leaderboard() {
    return Object.entries(this.scores)
      .map(([id, pts]) => ({ id, name: this.nameOf(id), pts, isMe: id === this.me }))
      .sort((a, b) => b.pts - a.pts);
  }
}

// ================================================================ quick games

export const THROWABLES = [
  { id: 'tomato', emoji: '🍅', label: 'Tomato', splat: '#dc2626' },
  { id: 'egg', emoji: '🥚', label: 'Egg', splat: '#fde047' },
  { id: 'pie', emoji: '🥧', label: 'Pie', splat: '#f5f5f4' },
  { id: 'slime', emoji: '🟢', label: 'Slime', splat: '#22c55e' },
  { id: 'heart', emoji: '💖', label: 'Love', splat: '' },
  { id: 'flower', emoji: '💐', label: 'Flowers', splat: '' },
  { id: 'snowball', emoji: '❄️', label: 'Snowball', splat: '#e0f2fe' },
  { id: 'shoe', emoji: '👟', label: 'Shoe', splat: '' },
] as const;
export type ThrowId = (typeof THROWABLES)[number]['id'];

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export const RPS_EMOJI: Record<RpsChoice, string> = { rock: '✊', paper: '✋', scissors: '✌️' };

type FunMsg =
  | { op: 'throw'; target: string; item: ThrowId }
  | { op: 'spin'; names: string[]; idx: number }
  | { op: 'rps-challenge'; id: string }
  | { op: 'rps-pick'; id: string; choice: RpsChoice }
  | { op: 'rps-result'; a: string; b: string; ac: RpsChoice; bc: RpsChoice; winner: string | null };

export type FunEvent =
  | { kind: 'throw'; from: string; target: string; item: ThrowId }
  | { kind: 'spin'; by: string; names: string[]; idx: number }
  | { kind: 'rps-challenge'; id: string; from: string; name: string }
  | { kind: 'rps-result'; a: string; b: string; aName: string; bName: string; ac: RpsChoice; bc: RpsChoice; winner: string | null };

const beats: Record<RpsChoice, RpsChoice> = { rock: 'scissors', paper: 'rock', scissors: 'paper' };

/** Throwables, spin-the-wheel and rock-paper-scissors duels. */
export class FunStore {
  private listeners = new Set<(e: FunEvent) => void>();
  private pendingRps = new Map<string, { to: string; choice: RpsChoice }>();
  private lastThrow = 0;
  private off: () => void;

  constructor(private session: MeetingSession) {
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'fun') this.apply(e.data as FunMsg, e.from, e.name);
    });
  }

  dispose() {
    this.off();
  }

  on(fn: (e: FunEvent) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private fire(e: FunEvent) {
    this.listeners.forEach((f) => f(e));
  }

  private nameOf(id: string) {
    return this.session.getSnapshot().participants.find((p) => p.id === id)?.name ?? 'Someone';
  }

  throwAt(target: string, item: ThrowId) {
    const now = Date.now();
    if (now - this.lastThrow < 350) return;
    this.lastThrow = now;
    this.session.sendApp('fun', { op: 'throw', target, item } satisfies FunMsg);
    this.fire({ kind: 'throw', from: this.session.selfId, target, item });
  }

  spin() {
    const names = this.session
      .getSnapshot()
      .participants.filter((p) => !p.leaving)
      .map((p) => p.name)
      .slice(0, 16);
    if (names.length < 2) return false;
    const idx = Math.floor(Math.random() * names.length);
    this.session.sendApp('fun', { op: 'spin', names, idx } satisfies FunMsg);
    this.fire({ kind: 'spin', by: this.session.selfId, names, idx });
    return true;
  }

  /** You pick first (secretly); the opponent picks; you announce the result to everyone. */
  challenge(to: string, choice: RpsChoice) {
    const id = randomId(5);
    this.pendingRps.set(id, { to, choice });
    this.session.sendApp('fun', { op: 'rps-challenge', id } satisfies FunMsg, to);
  }

  answer(id: string, challenger: string, choice: RpsChoice) {
    this.session.sendApp('fun', { op: 'rps-pick', id, choice } satisfies FunMsg, challenger);
  }

  private apply(m: FunMsg, from: string, name: string) {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'throw' && THROWABLES.some((t) => t.id === m.item)) {
      this.fire({ kind: 'throw', from, target: m.target, item: m.item });
    } else if (m.op === 'spin' && Array.isArray(m.names) && m.names.length >= 2 && m.idx >= 0 && m.idx < m.names.length) {
      this.fire({ kind: 'spin', by: from, names: m.names.map((n) => String(n).slice(0, 40)).slice(0, 16), idx: m.idx });
    } else if (m.op === 'rps-challenge') {
      this.fire({ kind: 'rps-challenge', id: m.id, from, name });
    } else if (m.op === 'rps-pick') {
      const p = this.pendingRps.get(m.id);
      if (!p || p.to !== from || !(m.choice in beats)) return;
      this.pendingRps.delete(m.id);
      const me = this.session.selfId;
      const winner = p.choice === m.choice ? null : beats[p.choice] === m.choice ? me : from;
      const res: FunMsg = { op: 'rps-result', a: me, b: from, ac: p.choice, bc: m.choice, winner };
      this.session.sendApp('fun', res);
      this.apply(res, me, '');
    } else if (m.op === 'rps-result') {
      this.fire({ kind: 'rps-result', a: m.a, b: m.b, aName: this.nameOf(m.a), bName: this.nameOf(m.b), ac: m.ac, bc: m.bc, winner: m.winner });
    }
  }
}
