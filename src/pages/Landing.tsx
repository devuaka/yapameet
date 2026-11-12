import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Clock, Keyboard, Plus, Zap } from 'lucide-react';
import { Avatar } from '../components/controls';
import { getRecentMeetings } from '../lib/hooks';
import { usePfp } from '../lib/pfp';
import { SiteHeader } from '../components/Brand';
import { parseMeetingInput } from '../lib/meetingCode';
import { findEgg, updateSettings, useSettings } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { useToast } from '../components/Toast';

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const s = useSettings();
  const pfp = usePfp();
  const recent = getRecentMeetings().slice(0, 4);
  const [spin, setSpin] = useState(false);
  const toast = useToast();
  const clicks = useRef<number[]>([]);

  // Easter egg: the logo is ticklish (5 quick clicks).
  const onLogo = () => {
    const t = Date.now();
    clicks.current = [...clicks.current.filter((x) => t - x < 2500), t];
    sounds.pop();
    if (clicks.current.length >= 5) {
      clicks.current = [];
      setSpin(false);
      requestAnimationFrame(() => setSpin(true));
      window.setTimeout(() => setSpin(false), 1200);
      if (findEgg('bubblegum')) {
        sounds.secret();
        toast('🍬 Secret found: Ticklish. Bubblegum theme unlocked!', 'success');
        updateSettings({ theme: 'bubblegum' });
      } else toast('Hehe, that tickles 🤭');
    }
  };

  const join = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseMeetingInput(code);
    if (!parsed) {
      setError('Enter a meeting code like abc-defg-hij, or paste a meeting link.');
      return;
    }
    nav(`/meeting/${parsed}`);
  };

  return (
    <div className="page landing">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader onLogoClick={onLogo} spin={spin} />
      <main className="hero">
        <div className="hero-copy">
          {s.displayName ? (
            <Link to="/settings#profile" className="pill pill-hello" title="Your profile" data-testid="hello">
              <Avatar name={s.displayName} size={22} src={pfp} /> Hey, {s.displayName.split(' ')[0]} 👋
            </Link>
          ) : (
            <span className="pill">
              <Zap size={14} /> Free · No account · Peer-to-peer
            </span>
          )}
          <h1>
            Hop on a call.
            <br />
            <span className="gradient-text">Start yapping.</span>
          </h1>
          <p className="lead">
            Video calls straight from your browser. Make a link, send it, talk. Your video goes directly between
            people, never through a server.
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => nav('/new')} data-testid="new-meeting">
              <Plus size={20} /> New meeting
            </button>
            <form className="code-form" onSubmit={join}>
              <div className={`input-icon ${error ? 'has-error' : ''}`}>
                <Keyboard size={18} />
                <input
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError('');
                  }}
                  placeholder="Enter a code or link"
                  aria-label="Meeting code or link"
                  data-testid="landing-code"
                />
              </div>
              <button className="btn btn-ghost btn-lg" type="submit" disabled={!code.trim()}>
                Join
              </button>
            </form>
          </div>
          {error && <p className="error-text">{error}</p>}
          {recent.length > 0 && (
            <div className="recent-row" data-testid="recent-row">
              <span className="muted small">
                <Clock size={13} /> Recent
              </span>
              {recent.map((m) => (
                <Link key={m.code} to={`/meeting/${m.code}`} className="recent-chip" title={`Rejoin ${m.code}`}>
                  <span className="mono">{m.code}</span>
                  <small>{ago(m.at)}</small>
                </Link>
              ))}
            </div>
          )}
        </div>
        <div className="hero-art" aria-hidden="true">
          <div className="mock-window">
            <div className="mock-grid">
              {['#8b5cf6', '#3b82f6', '#ec4899', '#14b8a6'].map((c, i) => (
                <div key={i} className={`mock-tile ${i === 1 ? 'speaking' : ''}`} style={{ ['--c' as string]: c }}>
                  <div className="mock-avatar" />
                  <div className="mock-name" />
                </div>
              ))}
            </div>
            <div className="mock-bar">
              <span />
              <span />
              <span className="red" />
              <span />
            </div>
          </div>
        </div>
      </main>

      <section className="feature-strip" aria-label="What's inside">
        {['🖥️ Screen share', '🎬 Watch together', '🎮 Games', '✏️ Whiteboard', '🔊 Soundboard', '🎭 Face stickers', '💬 Chat & polls', '🔒 Peer-to-peer, encrypted'].map((t) => (
          <span key={t}>{t}</span>
        ))}
      </section>

      <footer className="site-footer">
        <span>Yapameet · Works best in Chrome and Edge</span>
      </footer>
    </div>
  );
}

function ago(ts: number) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString();
}
