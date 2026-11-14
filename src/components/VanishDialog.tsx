import { useEffect, useMemo, useState } from 'react';
import { Zap } from 'lucide-react';
import type { LocalMedia } from '../rtc/LocalMedia';
import type { MeetingSession } from '../rtc/MeetingSession';
import { useEmitter } from '../lib/hooks';
import { sounds } from '../lib/sounds';
import { Modal } from './controls';
import { VideoView } from './media';

const OUT_SECS = 5;
const IN_SECS = 3;

/**
 * Secret toy "Lightning Vanish": step out, the empty room is photographed, step
 * back in, and then lightning strikes you and you vanish into that photo.
 */
export function VanishDialog({ local, session, onClose }: { local: LocalMedia; session: MeetingSession; onClose: () => void }) {
  useEmitter(local);
  const [phase, setPhase] = useState<'out' | 'in' | 'failed'>('out');
  const [count, setCount] = useState(OUT_SECS);
  const raw = useMemo(() => (local.rawCam ? new MediaStream([local.rawCam]) : null), [local.rawCam]);
  const hasCam = !!local.rawCam;

  useEffect(() => {
    if (!hasCam) return;
    let stop = false;
    let photo: string | null = null;
    let n = OUT_SECS;
    let stage: 'out' | 'in' = 'out';
    const cleanups: (() => void)[] = [];
    sounds.tick();
    const timer = window.setInterval(async () => {
      n--;
      setCount(n);
      if (n > 0) {
        sounds.tick();
        return;
      }
      if (stage === 'out') {
        clearInterval(timer);
        photo = await local.captureRawFrame(640);
        if (stop) return;
        sounds.shutter();
        if (!photo) {
          setPhase('failed');
          return;
        }
        // Step back in, then the strike.
        stage = 'in';
        n = IN_SECS;
        setPhase('in');
        setCount(n);
        const again = window.setInterval(() => {
          n--;
          setCount(n);
          if (n > 0) return;
          clearInterval(again);
          if (stop) return;
          session.strike(photo!);
          onClose();
        }, 1000);
        cleanups.push(() => clearInterval(again));
      }
    }, 1000);
    cleanups.push(() => clearInterval(timer));
    return () => {
      stop = true;
      cleanups.forEach((f) => f());
    };
    // Runs once per opening; the dialog closes itself when done.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasCam]);

  return (
    <Modal title="⚡ Lightning Vanish" onClose={onClose} wide>
      <div className="ghost-dialog vanish-dialog" data-testid="vanish-dialog">
        {!hasCam ? (
          <p className="error-text">Turn your camera on first. The toy needs a photo of your room.</p>
        ) : phase === 'failed' ? (
          <p className="error-text">Couldn't take the photo. Close this and try again.</p>
        ) : (
          <div className={`ghost-countdown vanish-${phase}`}>
            {raw && <VideoView stream={raw} mirror />}
            <div className="ghost-count" data-testid="vanish-count" key={`${phase}-${count}`}>
              {count > 0 ? count : phase === 'out' ? '📸' : <Zap size={110} />}
            </div>
            <p className="ghost-go">{phase === 'out' ? 'Step out of the frame!' : 'Get back in the frame!'}</p>
          </div>
        )}
        <p className="muted small">
          Everyone sees lightning strike you, then only your empty room for 15 seconds. Keep the camera still or the trick
          shows.
        </p>
      </div>
    </Modal>
  );
}
