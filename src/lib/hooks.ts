import { useEffect, useReducer, useState } from 'react';

/** Re-render whenever a mutable engine object (LocalMedia etc.) emits. */
export function useEmitter(em: { subscribe: (fn: () => void) => () => void } | null | undefined) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => (em ? em.subscribe(force) : undefined), [em]);
}

export function useMediaQuery(q: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [q]);
  return m;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

const RECENT_KEY = 'yapameet:recent';
export interface RecentMeeting {
  code: string;
  at: number;
}
export function getRecentMeetings(): RecentMeeting[] {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as RecentMeeting[]).slice(0, 6);
  } catch {
    return [];
  }
}
export function addRecentMeeting(code: string) {
  try {
    const list = getRecentMeetings().filter((m) => m.code !== code);
    localStorage.setItem(RECENT_KEY, JSON.stringify([{ code, at: Date.now() }, ...list].slice(0, 6)));
  } catch {
    /* ignore */
  }
}

export function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function formatDuration(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
