import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Ghost, RotateCcw, Trash2 } from 'lucide-react';
import type { LocalMedia } from '../rtc/LocalMedia';
import type { MeetingSession } from '../rtc/MeetingSession';
import { useEmitter } from '../lib/hooks';
import { sounds } from '../lib/sounds';
import { Modal } from './controls';
import { VideoView } from './media';

/**
 * Easter egg: "Ghost Protocol". Photograph your room while you're out of frame;
 * when you leave the call, everyone sees you fade out of your own room.
 */
export function GhostDialog({ local, session, onClose }: { local: LocalMedia; session: MeetingSession; onClose: () => void }) {
  useEmitter(local);
  const [phase, setPhase] = useState<'intro' | 'countdown' | 'done'>(session.roomPhoto ? 'done' : 'intro');
  const [count, setCount] = useState(5);
  const [photo, setPhoto] = useState<string | null>(session.roomPhoto);
  const timer = useRef(0);
  const raw = useMemo(() => (local.rawCam ? new MediaStream([local.rawCam]) : null), [local.rawCam]);

  useEffect(() => () => clearInterval(timer.current), []);

  const start = () => {
    if (!local.rawCam) return;
    setPhase('countdown');
    setCount(5);
    sounds.tick();
    let n = 5;
    timer.current = window.setInterval(async () => {
      n--;
      setCount(n);
      if (n > 0) {
        sounds.tick();
        return;
      }
      clearInterval(timer.current);
      const shot = await local.captureRawFrame();
      sounds.shutter();
      if (shot) {
        setPhoto(shot);
        session.setRoomPhoto(shot);
        setPhase('done');
      } else setPhase('intro');
    }, 1000);
  };

  const disarm = () => {
    session.setRoomPhoto(null);
    setPhoto(null);
    setPhase('intro');
  };

  return (
    <Modal title="👻 Ghost Protocol" onClose={onClose} wide>
      <div className="ghost-dialog" data-testid="ghost-dialog">
        {phase === 'intro' && (
          <>
            <p>
              You found something. Take a photo of your room <b>without you in it</b>. When you leave this call, everyone
              watches you slowly fade out of your own room until only the empty room is left. Spooky.
            </p>
            <ol className="ghost-steps">
              <li>Keep the camera still.</li>
              <li>Press the button, then step out of frame within 5 seconds.</li>
              <li>Come back. Leave the call whenever you like.</li>
            </ol>
            {!local.rawCam && <p className="error-text">Turn your camera on first.</p>}
            <button className="btn btn-primary" onClick={start} disabled={!local.rawCam} data-testid="ghost-start">
              <Camera size={18} /> Capture my empty room
            </button>
          </>
        )}
        {phase === 'countdown' && (
          <div className="ghost-countdown">
            {raw && <VideoView stream={raw} />}
            <div className="ghost-count" data-testid="ghost-count">
              {count > 0 ? count : '📸'}
            </div>
            <p className="ghost-go">Step out of the frame!</p>
          </div>
        )}
        {phase === 'done' && photo && (
          <>
            <div className="ghost-photo">
              <img src={photo} alt="Your empty room" />
              <span className="ghost-armed">
                <Ghost size={14} /> Armed
              </span>
            </div>
            <p className="muted">
              When you leave, you'll fade into this photo for everyone in the call. Move the camera and the illusion breaks,
              so keep it still.
            </p>
            <div className="create-actions">
              <button className="btn btn-primary" onClick={onClose} data-testid="ghost-done">
                Done
              </button>
              <button className="btn btn-ghost" onClick={start}>
                <RotateCcw size={16} /> Retake
              </button>
              <button className="btn btn-ghost" onClick={disarm}>
                <Trash2 size={16} /> Disarm
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
