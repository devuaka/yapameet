import { Link } from 'react-router-dom';
import { Settings } from 'lucide-react';
import type { ReactNode } from 'react';

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="yg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill="url(#yg)" />
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

export function SiteHeader({ right, onLogoClick, spin }: { right?: ReactNode; onLogoClick?: () => void; spin?: boolean }) {
  return (
    <header className="site-header">
      <BrandLink onClick={onLogoClick} spin={spin} />
      <nav className="site-nav">
        {right}
        <Link to="/settings" className="icon-link" aria-label="Settings" title="Settings">
          <Settings size={20} />
        </Link>
      </nav>
    </header>
  );
}
