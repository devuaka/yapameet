import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Home, RotateCcw } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { PreJoin } from '../components/PreJoin';
import { CallView } from '../components/CallView';
import { LocalMedia } from '../rtc/LocalMedia';
import { MeetingSession } from '../rtc/MeetingSession';
import { parseMeetingInput } from '../lib/meetingCode';
import { cryptoAvailable } from '../lib/crypto';
import { addRecentMeeting, formatDuration } from '../lib/hooks';
import { updateSettings } from '../lib/settings';
import { getAudioContext, preloadSounds, sounds } from '../lib/sounds';

type Phase = 'lobby' | 'call' | 'left';

export function MeetingPage() {
  const params = useParams();
  const nav = useNavigate();
  const code = parseMeetingInput(params.code ?? '');
  const [local] = useState(() => new LocalMedia());
  const [phase, setPhase] = useState<Phase>('lobby');
  const [session, setSession] = useState<MeetingSession | null>(null);
  const sessionRef = useRef<MeetingSession | null>(null);
  const [callDuration, setCallDuration] = useState(0);

  // Normalize odd URLs (caps, missing dashes) to the canonical one.
  useEffect(() => {
    if (code && code !== params.code) nav(`/meeting/${code}`, { replace: true });
  }, [code, params.code, nav]);

  useEffect(() => {
    void local.start();
    return () => {
      // Leaving the page by any route (back button, link) must hang up and release devices.
      void sessionRef.current?.leave();
      sessionRef.current = null;
      local.dispose();
    };
  }, [local]);

  useEffect(() => {
    document.title = code ? `${code} · Yapameet` : 'Yapameet';
    return () => {
      document.title = 'Yapameet';
    };
  }, [code]);

  const join = useCallback(
    async (name: string) => {
      if (!code) return;
      updateSettings({ displayName: name });
      getAudioContext(); // unlock WebAudio inside the click gesture
      preloadSounds();
      addRecentMeeting(code);
      const s = new MeetingSession(code, local, name);
      sessionRef.current = s;
      setSession(s);
      setPhase('call');
      sounds.selfJoin();
      await s.join();
    },
    [code, local],
  );

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (s) {
      setCallDuration(Date.now() - (s.getSnapshot().participants[0]?.joinedAt || Date.now()));
      await s.leave();
    }
    local.stopAll();
    sounds.leave();
    setSession(null);
    setPhase('left');
  }, [local]);

  const rejoin = () => {
    void local.start();
    setPhase('lobby');
  };

  if (!code) {
    return (
      <Shell emoji="🤔" title="That link doesn't look right">
        <p className="muted">Meeting codes are 3 to 40 letters, numbers or dashes, like abc-defg-hij.</p>
        <div className="btn-row">
          <Link className="btn btn-primary" to="/">
            <Home size={18} /> Go home
          </Link>
        </div>
      </Shell>
    );
  }

  if (!cryptoAvailable()) {
    return (
      <Shell emoji="🔒" title="Secure connection required">
        <p className="muted">
          Browsers only allow camera, microphone and encryption on secure pages. Open Yapameet over <b>https://</b> (or on localhost when
          developing).
        </p>
      </Shell>
    );
  }

  if (phase === 'left') {
    return (
      <Shell emoji="👋" title="You left the call">
        <p className="muted">{callDuration > 0 ? `You were in there for ${formatDuration(callDuration)}.` : 'See you next time.'}</p>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={rejoin} data-testid="rejoin">
            <RotateCcw size={18} /> Rejoin
          </button>
          <Link className="btn btn-ghost" to="/">
            <Home size={18} /> Home
          </Link>
        </div>
      </Shell>
    );
  }

  if (phase === 'call' && session) {
    return <CallView session={session} local={local} onLeave={() => void leave()} />;
  }

  return <PreJoin code={code} local={local} onJoin={(n) => void join(n)} />;
}

function Shell({ emoji, title, children }: { emoji: string; title: string; children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader bare />
      <main className="center-page">
        <div className="card center-card">
          <span className="center-emoji" aria-hidden="true">
            {emoji}
          </span>
          <h1>{title}</h1>
          {children}
        </div>
      </main>
    </div>
  );
}
