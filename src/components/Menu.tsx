import { useEffect, useRef, type ReactNode } from 'react';
import { Check } from 'lucide-react';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  checked?: boolean;
  hint?: string;
  danger?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
}

export interface MenuSection {
  title?: string;
  items: MenuItem[];
}

/** Popover menu that opens above its anchor (control bar menus). */
export function Menu({
  sections,
  onClose,
  align = 'center',
  testId,
  anchorTestId,
}: {
  sections: MenuSection[];
  onClose: () => void;
  align?: 'left' | 'center' | 'right';
  testId?: string;
  /** Clicks on the anchor button shouldn't count as "outside" (it toggles the menu itself). */
  anchorTestId?: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (box.current?.contains(t)) return;
      if (anchorTestId && t.closest(`[data-testid="${anchorTestId}"]`)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    box.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose, anchorTestId]);

  return (
    <div className={`menu menu-${align}`} ref={box} role="menu" data-testid={testId}>
      {sections
        .filter((s) => s.items.length)
        .map((s, i) => (
          <div className="menu-section" key={i}>
            {s.title && <div className="menu-title">{s.title}</div>}
            {s.items.map((it, j) => (
              <button
                key={j}
                role={it.checked === undefined ? 'menuitem' : 'menuitemradio'}
                aria-checked={it.checked}
                className={`menu-item ${it.danger ? 'danger' : ''} ${it.className ?? ''}`}
                disabled={it.disabled}
                onClick={() => {
                  it.onClick();
                  onClose();
                }}
                data-testid={it.testId}
              >
                <span className="menu-icon">{it.checked ? <Check size={16} /> : it.icon}</span>
                <span className="menu-label">{it.label}</span>
                {it.hint && <span className="menu-hint">{it.hint}</span>}
              </button>
            ))}
          </div>
        ))}
    </div>
  );
}
