import { useEffect } from 'react';

/** Tiny global bus for full-screen effects (confetti, barrel roll, party lights). */
export type FxName = 'confetti' | 'barrelroll' | 'party';
type Listener = (fx: FxName, by?: string) => void;
const listeners = new Set<Listener>();

export const fxBus = {
  emit(fx: FxName, by?: string) {
    for (const fn of listeners) fn(fx, by);
  },
  on(fn: Listener) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};

/** True while a call view is mounted (so global easter eggs can defer to it). */
export const callState = { active: false };

const KONAMI = ['arrowup', 'arrowup', 'arrowdown', 'arrowdown', 'arrowleft', 'arrowright', 'arrowleft', 'arrowright', 'b', 'a'];

export function useKonami(onCode: () => void) {
  useEffect(() => {
    let pos = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (k === KONAMI[pos]) {
        pos++;
        if (pos === KONAMI.length) {
          pos = 0;
          onCode();
        }
      } else pos = k === KONAMI[0] ? 1 : 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCode]);
}
