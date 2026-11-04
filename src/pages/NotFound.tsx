import { Link } from 'react-router-dom';
import { SiteHeader } from '../components/Brand';

export function NotFound() {
  return (
    <div className="page">
      <SiteHeader />
      <main className="center-page">
        <div className="card">
          <h1>Page not found</h1>
          <p className="muted">That page doesn't exist.</p>
          <Link className="btn btn-primary" to="/">
            Go home
          </Link>
        </div>
      </main>
    </div>
  );
}
