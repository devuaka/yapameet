import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Clapperboard,
  Clock,
  Gamepad2,
  Hand,
  Keyboard,
  Mic,
  MonitorUp,
  Music4,
  PenTool,
  PhoneOff,
  ShieldCheck,
  SmilePlus,
  Sparkles,
  Video,
  Zap,
} from 'lucide-react';
import { getRecentMeetings } from '../lib/hooks';
import { SiteHeader } from '../components/Brand';
import { generateMeetingCode, parseMeetingInput } from '../lib/meetingCode';
import { findEgg, updateSettings } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { useToast } from '../components/Toast';

const FEATURES = [
  { icon: <Clapperboard size={20} />, title: 'Watch together', text: 'YouTube, TikTok or your own video links, in sync for everyone.', c: '#f43f5e' },
  { icon: <Gamepad2 size={20} />, title: 'Games', text: 'Draw & Guess, spin the wheel, rock paper scissors, would you rather.', c: '#8b5cf6' },
  { icon: <PenTool size={20} />, title: 'Whiteboard', text: 'Sketch ideas (or nonsense) together in real time.', c: '#f59e0b' },
  { icon: <Music4 size={20} />, title: 'Soundboard & voices', text: 'Drop sound effects, upload your own, talk like a robot.', c: '#ec4899' },
  { icon: <Sparkles size={20} />, title: 'Backgrounds & stickers', text: 'Blur, virtual rooms, filters and stickers that follow your face.', c: '#38bdf8' },
  { icon: <ShieldCheck size={20} />, title: 'Private by design', text: 'Calls go straight between people, encrypted. No account needed.', c: '#34d399' },
];

const MOCK_PEOPLE = [
  { face: '😎', name: 'Maya', hue: 262 },
  { face: '🤠', name: 'Jo', hue: 212 },
  { face: '🐱', name: 'Kit', hue: 330 },
  { face: '👾', name: 'Sam', hue: 168 },
];

export function Landing() {
  const nav = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
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
        <span className="pill">
          <Zap size={14} /> Free · No account · No installs
        </span>
        <h1>
          Hop on a call.
          <br />
          <span className="gradient-text">Start yapping.</span>
        </h1>
        <p className="lead">Video calls straight from your browser. Make a link, send it to your people, and talk.</p>

        <div className="start-bar">
          <button className="btn btn-primary btn-lg" onClick={() => nav(`/meeting/${generateMeetingCode()}`)} data-testid="new-meeting">
            <Video size={20} /> New meeting
          </button>
          <form className={`code-form ${error ? 'has-error' : ''}`} onSubmit={join}>
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
            <button className="btn btn-small" type="submit" disabled={!code.trim()} data-testid="landing-join">
              Join <ArrowRight size={15} />
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
      </main>

      <div className="hero-art" aria-hidden="true">
        <div className="mock">
          <div className="mock-grid">
            {MOCK_PEOPLE.map((p, i) => (
              <div key={p.name} className={`mock-tile m${i + 1}`} style={{ ['--hue' as string]: p.hue }}>
                <span className="mock-face">{p.face}</span>
                <span className="mock-name">
                  <i className="eq on">
                    <b />
                    <b />
                    <b />
                  </i>
                  {p.name}
                </span>
                {i === 1 && (
                  <span className="mock-hand">
                    <Hand size={14} />
                  </span>
                )}
              </div>
            ))}
          </div>
          <span className="mock-float f1">🔥</span>
          <span className="mock-float f2">😂</span>
          <span className="mock-float f3">🎉</span>
          <div className="mock-bubble">
            <b>Kit</b> one more round? 🎮
          </div>
          <div className="mock-dock">
            <span>
              <Mic size={16} />
            </span>
            <span>
              <Video size={16} />
            </span>
            <span>
              <MonitorUp size={16} />
            </span>
            <span>
              <SmilePlus size={16} />
            </span>
            <span className="red">
              <PhoneOff size={16} />
            </span>
          </div>
        </div>
      </div>

      <section className="features" aria-label="What's inside">
        <h2>More than a video call</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature" style={{ ['--c' as string]: f.c }}>
              <span className="feature-icon">{f.icon}</span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="site-footer">
        <span>Yapameet · Free forever · Works best in Chrome and Edge</span>
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
