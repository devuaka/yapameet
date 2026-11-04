import { useEffect, useRef } from 'react';

export const REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '👏', '🎉', '🔥', '💯', '🤔', '😢', '🙌', '👀'];

export interface FloatingReaction {
  id: number;
  emoji: string;
  name: string;
  x: number;
}

export function ReactionPicker({ onPick, onClose }: { onPick: (emoji: string) => void; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('[data-testid="ctrl-react"]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);
  return (
    <div className="reaction-picker" ref={box} role="menu" aria-label="Send a reaction" data-testid="reaction-picker">
      {REACTION_EMOJIS.map((e) => (
        <button key={e} onClick={() => onPick(e)} role="menuitem" aria-label={`React ${e}`}>
          {e}
        </button>
      ))}
    </div>
  );
}

/** Emoji bubbles rising from the bottom of the stage, Meet-style but bouncier. */
export function ReactionLayer({ items }: { items: FloatingReaction[] }) {
  return (
    <div className="reaction-layer" aria-live="polite">
      {items.map((r) => (
        <div key={r.id} className="reaction-float" style={{ left: `${r.x}%` }} data-testid="reaction-float">
          <span className="reaction-emoji">{r.emoji}</span>
          <span className="reaction-name">{r.name}</span>
        </div>
      ))}
    </div>
  );
}
