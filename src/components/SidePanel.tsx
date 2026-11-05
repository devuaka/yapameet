import type { ReactNode } from 'react';
import { LayoutGrid, MessageSquare, Users, X } from 'lucide-react';

export type SideTab = 'people' | 'chat' | 'activities';

/** One side panel, three tabs: everything social lives in the same place. */
export function SidePanel({
  tab,
  onTab,
  onClose,
  counts,
  children,
}: {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  onClose: () => void;
  counts: { people: number; unread: number };
  children: ReactNode;
}) {
  const tabs: { id: SideTab; label: string; icon: ReactNode; badge?: number }[] = [
    { id: 'people', label: 'People', icon: <Users size={16} />, badge: counts.people },
    { id: 'chat', label: 'Chat', icon: <MessageSquare size={16} />, badge: tab === 'chat' ? 0 : counts.unread },
    { id: 'activities', label: 'Activities', icon: <LayoutGrid size={16} /> },
  ];
  return (
    <aside className="side-panel" aria-label="Side panel" data-testid="side-panel" data-tab={tab}>
      <div className="side-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? 'active' : ''}
            onClick={() => onTab(t.id)}
            data-testid={`side-tab-${t.id}`}
          >
            {t.icon}
            <span>{t.label}</span>
            {t.badge ? <span className="side-tab-badge">{t.id === 'people' ? t.badge : t.badge > 9 ? '9+' : t.badge}</span> : null}
          </button>
        ))}
        <button className="icon-btn ghost side-close" onClick={onClose} aria-label="Close side panel" data-testid="side-close">
          <X size={18} />
        </button>
      </div>
      {children}
    </aside>
  );
}
