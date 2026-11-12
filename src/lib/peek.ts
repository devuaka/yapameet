import { useEffect, useState } from 'react';
import { randomId } from './crypto';
import { SignalingChannel } from '../signaling/SignalingChannel';

/**
 * Before joining: ask the room who's already in the call (names only). Uses the
 * same encrypted signaling as the call, so only people with the code can see it.
 */
export function usePeek(code: string | null) {
  const [names, setNames] = useState<string[] | null>(null);
  useEffect(() => {
    if (!code) return;
    let closed = false;
    const seen = new Map<string, { name: string; at: number }>();
    const ch = new SignalingChannel(code, `peek-${randomId(6)}`);
    const publish = () => {
      const now = Date.now();
      for (const [k, v] of seen) if (now - v.at > 25000) seen.delete(k);
      setNames([...seen.values()].map((v) => v.name));
    };
    ch.onMessage = (from, msg) => {
      if (msg.t === 'peek-reply' && typeof msg.name === 'string') {
        seen.set(from, { name: msg.name.slice(0, 40), at: Date.now() });
        publish();
      } else if (msg.t === 'bye') {
        seen.delete(from);
        publish();
      }
    };
    let asked = false;
    ch.onStatus = (s) => {
      if (s === 'connected' && !asked) {
        asked = true;
        void ch.send({ t: 'peek' });
        // Nobody answered within a few seconds: say so instead of "checking".
        window.setTimeout(() => !closed && publish(), 3500);
      }
    };
    void ch.open().catch(() => {});
    const t = window.setInterval(() => {
      if (asked) void ch.send({ t: 'peek' });
      publish();
    }, 10000);
    return () => {
      closed = true;
      clearInterval(t);
      ch.close();
    };
  }, [code]);
  return names;
}
