import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import { Avatar } from './controls';
import { usePfp } from '../lib/pfp';
import { useSettings } from '../lib/settings';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="yg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill="url(#yg)" />
      <path
        d="M16 22a6 6 0 0 1 6-6h14a6 6 0 0 1 6 6v4l8-5v22l-8-5v4a6 6 0 0 1-6 6H27l-8 6v-6.5A6 6 0 0 1 16 42z"
        fill="#fff"
      />
      <circle cx="24" cy="32" r="2.6" style={{ fill: 'var(--accent)' }} />
      <circle cx="31" cy="32" r="2.6" style={{ fill: 'var(--accent)' }} />
      <circle cx="38" cy="32" r="2.6" style={{ fill: 'var(--accent)' }} />
    </svg>
  );
}

export function BrandLink({ onClick, spin }: { onClick?: () => void; spin?: boolean }) {
  return (
    <Link to="/" className={`brand ${spin ? 'spin-once' : ''}`} aria-label="Yapameet home" onClick={onClick} data-testid="brand">
      <Logo />
      <span className="brand-name">Yapameet</span>
    </Link>
  );
}

/** Top bar of every page outside a call: brand on the left, you (or the settings cog) on the right. */
export function SiteHeader({ onLogoClick, spin, bare }: { onLogoClick?: () => void; spin?: boolean; bare?: boolean }) {
  const s = useSettings();
  const pfp = usePfp();
  return (
    <header className="site-header">
      <BrandLink onClick={onLogoClick} spin={spin} />
      {!bare && (
        <nav className="site-nav">
          {s.displayName ? (
            <Link to="/settings#profile" className="me-chip" title="Your profile and settings" data-testid="hello">
              <Avatar name={s.displayName} size={28} src={pfp} />
              <span>{s.displayName.split(' ')[0]}</span>
            </Link>
          ) : (
            <Link to="/settings" className="icon-link" aria-label="Settings" title="Settings">
              <Settings size={20} />
            </Link>
          )}
        </nav>
      )}
    </header>
  );
}
