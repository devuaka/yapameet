import { Emitter } from '../lib/emitter';
import { randomId } from '../lib/crypto';
import type { MeetingSession, SessionEvent } from './MeetingSession';

// ---------------------------------------------------------------- polls

export interface Poll {
  id: string;
  question: string;
  options: string[];
  by: string;
  byName: string;
  anonymous: boolean;
  ended: boolean;
  createdAt: number;
}

type PollMsg =
  | { op: 'new'; poll: Poll }
  | { op: 'vote'; pollId: string; option: number }
  | { op: 'end'; pollId: string }
  | { op: 'snap'; polls: Poll[]; votes: [string, [string, number][]][] };

/** Polls: everyone tallies votes locally; newcomers receive the current polls and votes. */
export class PollStore extends Emitter {
  polls: Poll[] = [];
  /** pollId -> (voterId -> option index) */
  votes = new Map<string, Map<string, number>>();
  version = 0;
  onNewPoll: ((p: Poll) => void) | null = null;
  private off: () => void;

  constructor(private session: MeetingSession) {
    super();
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'poll') this.apply(e.data as PollMsg, e.from, e.name);
      else if (e.type === 'peer-ready' && this.polls.length) {
        this.session.sendApp(
          'poll',
          { op: 'snap', polls: this.polls, votes: [...this.votes].map(([k, v]) => [k, [...v]]) } satisfies PollMsg,
          e.from,
        );
      }
    });
  }

  dispose() {
    this.off();
  }

  private bump() {
    this.version++;
    this.emit();
  }

  create(question: string, options: string[], anonymous: boolean) {
    const poll: Poll = {
      id: randomId(6),
      question: question.trim().slice(0, 200),
      options: options.map((o) => o.trim().slice(0, 80)).filter(Boolean).slice(0, 8),
      by: this.session.selfId,
      byName: this.session.getSnapshot().participants[0]?.name ?? 'You',
      anonymous,
      ended: false,
      createdAt: Date.now(),
    };
    if (!poll.question || poll.options.length < 2) return null;
    this.polls = [poll, ...this.polls];
    this.session.sendApp('poll', { op: 'new', poll } satisfies PollMsg);
    this.bump();
    return poll;
  }

  vote(pollId: string, option: number) {
    const p = this.polls.find((x) => x.id === pollId);
    if (!p || p.ended) return;
    this.setVote(pollId, this.session.selfId, option);
    this.session.sendApp('poll', { op: 'vote', pollId, option } satisfies PollMsg);
  }

  end(pollId: string) {
    const p = this.polls.find((x) => x.id === pollId);
    if (!p || p.by !== this.session.selfId) return;
    p.ended = true;
    this.session.sendApp('poll', { op: 'end', pollId } satisfies PollMsg);
    this.bump();
  }

  myVote(pollId: string) {
    return this.votes.get(pollId)?.get(this.session.selfId);
  }

  tally(pollId: string) {
    const p = this.polls.find((x) => x.id === pollId);
    const counts = new Array(p?.options.length ?? 0).fill(0) as number[];
    const voters: string[][] = counts.map(() => []);
    for (const [voter, opt] of this.votes.get(pollId) ?? []) {
      if (opt >= 0 && opt < counts.length) {
        counts[opt]++;
        voters[opt].push(voter);
      }
    }
    return { counts, voters, total: counts.reduce((a, b) => a + b, 0) };
  }

  private setVote(pollId: string, voter: string, option: number) {
    let m = this.votes.get(pollId);
    if (!m) this.votes.set(pollId, (m = new Map()));
    m.set(voter, option);
    this.bump();
  }

  private apply(m: PollMsg, from: string, name: string) {
    if (!m || typeof m !== 'object') return;
    if (m.op === 'new' && m.poll?.id && !this.polls.some((p) => p.id === m.poll.id)) {
      const poll = { ...m.poll, by: from, byName: name, ended: false };
      this.polls = [poll, ...this.polls];
      this.onNewPoll?.(poll);
      this.bump();
    } else if (m.op === 'vote' && typeof m.option === 'number') {
      this.setVote(m.pollId, from, m.option);
    } else if (m.op === 'end') {
      const p = this.polls.find((x) => x.id === m.pollId);
      if (p && p.by === from) {
        p.ended = true;
        this.bump();
      }
    } else if (m.op === 'snap' && Array.isArray(m.polls)) {
      for (const p of m.polls) if (p?.id && !this.polls.some((x) => x.id === p.id)) this.polls.push(p);
      this.polls.sort((a, b) => b.createdAt - a.createdAt);
      for (const [pid, list] of m.votes ?? []) for (const [voter, opt] of list) if (!this.votes.get(pid)?.has(voter)) this.setVote(pid, voter, opt);
      this.bump();
    }
  }
}

// ---------------------------------------------------------------- shared timer

type TimerMsg = { op: 'start'; remaining: number; duration: number; label: string } | { op: 'stop' };

/** A countdown everyone sees. Sent as "time remaining" so clock differences don't matter. */
export class TimerStore extends Emitter {
  endsAt = 0;
  duration = 0;
  label = '';
  startedBy = '';
  version = 0;
  onDone: (() => void) | null = null;
  private tick: number | null = null;
  private off: () => void;

  constructor(private session: MeetingSession) {
    super();
    this.off = session.onEvent((e: SessionEvent) => {
      if (e.type === 'app' && e.kind === 'timer') this.apply(e.data as TimerMsg, e.name);
      else if (e.type === 'peer-ready' && this.running) {
        this.session.sendApp('timer', { op: 'start', remaining: this.remaining, duration: this.duration, label: this.label } satisfies TimerMsg, e.from);
      }
    });
  }

  get running() {
    return this.endsAt > Date.now();
  }

  get remaining() {
    return Math.max(0, this.endsAt - Date.now());
  }

  dispose() {
    this.off();
    if (this.tick) clearInterval(this.tick);
  }

  start(ms: number, label = '') {
    this.set(ms, ms, label.slice(0, 40), 'You');
    this.session.sendApp('timer', { op: 'start', remaining: ms, duration: ms, label: this.label } satisfies TimerMsg);
  }

  stop() {
    this.clear();
    this.session.sendApp('timer', { op: 'stop' } satisfies TimerMsg);
  }

  private set(remaining: number, duration: number, label: string, by: string) {
    this.endsAt = Date.now() + Math.min(remaining, 24 * 3600_000);
    this.duration = duration;
    this.label = label;
    this.startedBy = by;
    if (this.tick) clearInterval(this.tick);
    this.tick = window.setInterval(() => {
      this.version++;
      if (!this.running) {
        clearInterval(this.tick!);
        this.tick = null;
        this.endsAt = 0;
        this.onDone?.();
      }
      this.emit();
    }, 250);
    this.version++;
    this.emit();
  }

  private clear() {
    if (this.tick) clearInterval(this.tick);
    this.tick = null;
    this.endsAt = 0;
    this.version++;
    this.emit();
  }

  private apply(m: TimerMsg, name: string) {
    if (m?.op === 'start' && typeof m.remaining === 'number') this.set(m.remaining, m.duration || m.remaining, String(m.label || ''), name);
    else if (m?.op === 'stop') this.clear();
  }
}

export function formatClock(ms: number) {
  const s = Math.ceil(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${m}:${String(s % 60).padStart(2, '0')}`;
}
