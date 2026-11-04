import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Clock, LogIn } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { parseMeetingInput } from '../lib/meetingCode';
import { getRecentMeetings } from '../lib/hooks';

export function JoinPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [value, setValue] = useState(params.get('code') ?? '');
  const [error, setError] = useState('');
  const recent = getRecentMeetings();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = parseMeetingInput(value);
    if (!code) {
      setError("That doesn't look like a meeting code. Codes look like abc-defg-hij.");
      return;
    }
    nav(`/meeting/${code}`);
  };

  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader />
      <main className="center-page">
        <form className="card join-card" onSubmit={submit}>
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> Back
          </Link>
          <h1>Join a meeting</h1>
          <p className="muted">Paste the meeting link you were sent, or type the code.</p>
          <label className="field">
            <span>Meeting code or link</span>
            <input
              autoFocus
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setError('');
              }}
              placeholder="abc-defg-hij"
              data-testid="join-code"
            />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={!value.trim()} data-testid="join-submit">
            <LogIn size={20} /> Continue
          </button>
          {recent.length > 0 && (
            <div className="recent">
              <h3>
                <Clock size={14} /> Recent meetings
              </h3>
              {recent.map((m) => (
                <Link key={m.code} to={`/meeting/${m.code}`} className="recent-item">
                  <span className="mono">{m.code}</span>
                  <span className="muted small">{new Date(m.at).toLocaleDateString()}</span>
                </Link>
              ))}
            </div>
          )}
        </form>
      </main>
    </div>
  );
}
