import { useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Keyboard, Lock, MessageSquare, MonitorUp, Plus, Users, Video, Zap } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { parseMeetingInput } from '../lib/meetingCode';
import { findEgg, updateSettings } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { useToast } from '../components/Toast';

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
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
          <span className="pill">
            <Zap size={14} /> Free · No account · Peer-to-peer
          </span>
          <h1>
            Hop on a call.
            <br />
            <span className="gradient-text">Start yapping.</span>
          </h1>
          <p className="lead">
            Yapameet is video meetings straight from your browser. Make a link, send it, talk. Your video goes directly
            between participants, not through our servers (we don't have any).
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

      <section className="features">
        {[
          { icon: <Video />, title: 'HD video & audio', text: 'Camera, mic and speaker selection, noise suppression, speaking indicators.' },
          { icon: <MonitorUp />, title: 'Screen sharing', text: 'Share a tab, window or full screen, with tab or system audio where the browser supports it.' },
          { icon: <MessageSquare />, title: 'Live chat', text: 'Message everyone in the meeting with names, timestamps and unread badges.' },
          { icon: <Lock />, title: 'Private by design', text: 'Media is encrypted peer-to-peer (DTLS-SRTP). Signaling is encrypted with a key from your meeting code.' },
          { icon: <Users />, title: 'Small groups', text: 'Best for 2 to 6 people. Every participant connects directly to every other.' },
          { icon: <Zap />, title: 'Zero cost', text: 'Static site + free signaling. Nothing to install, no account, no server bill.' },
        ].map((f) => (
          <div className="feature-card" key={f.title}>
            <div className="feature-icon">{f.icon}</div>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </section>

      <footer className="site-footer">
        <span>Yapameet · Works best in Chrome and Edge</span>
      </footer>
    </div>
  );
}
