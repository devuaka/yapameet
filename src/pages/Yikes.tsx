import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { jumpscare } from '../lib/jumpscare';
import { findEgg } from '../lib/settings';
import { getAudioContext, loadSfx, sounds } from '../lib/sounds';

/**
 * Hidden page at /yikes. A creepy "don't click" bait; clicking (which also lets the
 * browser play sound) waits a moment, then jumpscares you and unlocks the Yikes secret.
 */
export function YikesPage() {
  const [phase, setPhase] = useState<'bait' | 'waiting' | 'done'>('bait');
  const [first, setFirst] = useState(false);

  useEffect(() => {
    document.title = '...';
    void loadSfx('egg-yikes');
    return () => {
      document.title = 'Yapameet';
    };
  }, []);

  const go = () => {
    getAudioContext(); // unlock audio inside the click
    setPhase('waiting');
    window.setTimeout(() => {
      jumpscare();
      window.setTimeout(() => {
        const isNew = findEgg('yikes');
        setFirst(isNew);
        if (isNew) sounds.secret();
        setPhase('done');
      }, 1700);
    }, 1400 + Math.random() * 900);
  };

  return (
    <div className="yikes-page" data-testid="yikes-page">
      {phase === 'bait' && (
        <div className="yikes-bait">
          <p className="yikes-whisper">there's nothing here.</p>
          <button className="yikes-btn" onClick={go} data-testid="yikes-go">
            don't click this
          </button>
        </div>
      )}
      {phase === 'waiting' && <p className="yikes-whisper flicker">...</p>}
      {phase === 'done' && (
        <div className="card center-card yikes-result" data-testid="yikes-result">
          <span className="center-emoji" aria-hidden="true">
            👹
          </span>
          <h1>{first ? 'Secret found: Yikes' : 'Still scary?'}</h1>
          <p className="muted">
            Now you can do that to your friends. In a call, open Activities, then Games, and press <b>Yikes</b> under Secrets. Everyone in the call gets
            it.
          </p>
          <div className="btn-row">
            <Link className="btn btn-primary" to="/">
              <Home size={18} /> Go home
            </Link>
            <button className="btn btn-ghost" onClick={() => setPhase('bait')}>
              Again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
