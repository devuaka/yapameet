import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { SiteHeader } from '../components/Brand';

export function NotFound() {
  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader />
      <main className="center-page">
        <div className="card center-card">
          <span className="center-emoji" aria-hidden="true">
            🫥
          </span>
          <h1>Nothing here</h1>
          <p className="muted">That page doesn't exist.</p>
          <div className="btn-row">
            <Link className="btn btn-primary" to="/">
              <Home size={18} /> Go home
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
