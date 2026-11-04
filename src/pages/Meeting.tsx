import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Home, RotateCcw } from 'lucide-react';
import { BrandLink } from '../components/Brand';
import { PreJoin } from '../components/PreJoin';
import { CallView } from '../components/CallView';
import { LocalMedia } from '../rtc/LocalMedia';
import { MeetingSession } from '../rtc/MeetingSession';
import { parseMeetingInput } from '../lib/meetingCode';
import { cryptoAvailable } from '../lib/crypto';
import { addRecentMeeting, formatDuration } from '../lib/hooks';
import { getSettings, updateSettings } from '../lib/settings';
import { getAudioContext, sounds } from '../lib/sounds';

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
      <Shell>
        <h1>Invalid meeting link</h1>
        <p className="muted">Meeting codes are 3 to 40 letters, numbers or dashes, like abc-defg-hij.</p>
        <Link className="btn btn-primary" to="/join">
          Enter a code
        </Link>
      </Shell>
    );
  }

  if (!cryptoAvailable()) {
    return (
      <Shell>
        <h1>Secure connection required</h1>
        <p className="muted">
          Browsers only allow camera, microphone and encryption on secure pages. Open Yapameet over <b>https://</b> (or
          on localhost when developing).
        </p>
      </Shell>
    );
  }

  if (phase === 'left') {
    return (
      <Shell>
        <h1>You left the meeting</h1>
        {callDuration > 0 && <p className="muted">Call time {formatDuration(callDuration)}</p>}
        <div className="create-actions">
          <button className="btn btn-primary" onClick={rejoin} data-testid="rejoin">
            <RotateCcw size={18} /> Rejoin
          </button>
          <Link className="btn btn-ghost" to="/">
            <Home size={18} /> Return home
          </Link>
        </div>
      </Shell>
    );
  }

  if (phase === 'call' && session) {
    return <CallView session={session} local={local} onLeave={() => void leave()} />;
  }

  return <PreJoin code={code} local={local} defaultName={getSettings().displayName} onJoin={(n) => void join(n)} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <header className="site-header">
        <BrandLink />
      </header>
      <main className="center-page">
        <div className="card center-card">{children}</div>
      </main>
    </div>
  );
}
