import type { ReactNode } from 'react';
import { ArrowLeft, X } from 'lucide-react';

export type SideTab = 'people' | 'chat' | 'activities';

/** The one side panel. What it shows is picked with the buttons in the call bar. */
export function SidePanel({
  tab,
  title,
  count,
  onBack,
  onClose,
  children,
}: {
  tab: SideTab;
  title: string;
  /** Small number next to the title (people in the call). */
  count?: number;
  /** Shown as a back arrow, e.g. from a game back to the list of activities. */
  onBack?: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside className="side-panel" aria-label={title} data-testid="side-panel" data-tab={tab}>
      <header className="side-head">
        {onBack && (
          <button className="icon-btn ghost" onClick={onBack} aria-label="Back to activities" data-testid="act-back">
            <ArrowLeft size={18} />
          </button>
        )}
        <h2>
          {title}
          {count !== undefined && <span className="side-count">{count}</span>}
        </h2>
        <button className="icon-btn ghost side-close" onClick={onClose} aria-label="Close panel" data-testid="side-close">
          <X size={18} />
        </button>
      </header>
      {children}
    </aside>
  );
}
