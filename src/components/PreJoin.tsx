import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Mic, MicOff, Settings as SettingsIcon, Video, VideoOff } from 'lucide-react';
import { BrandLink } from './Brand';
import { Avatar, DeviceSelect, Modal } from './controls';
import { DevicePanel } from './DevicePanel';
import { LevelMeter, VideoView } from './media';
import { copyText, useToast } from './Toast';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useEmitter } from '../lib/hooks';
import { meetingUrl } from '../lib/meetingCode';
import { useSettings } from '../lib/settings';
import { audioLevels } from '../lib/audioLevel';

const PREVIEW_ID = '__prejoin-mic';

/** Waiting room: check camera/mic, pick devices, set a name, then join. */
export function PreJoin({
  code,
  local,
  defaultName,
  onJoin,
}: {
  code: string;
  local: LocalMedia;
  defaultName: string;
  onJoin: (name: string) => void;
}) {
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const [name, setName] = useState(defaultName);
  const [showSettings, setShowSettings] = useState(false);
  const mics = local.devices.filter((d) => d.kind === 'audioinput');
  const cams = local.devices.filter((d) => d.kind === 'videoinput');

  useEffect(() => {
    audioLevels.watch(PREVIEW_ID, local.micStream);
    return () => audioLevels.unwatch(PREVIEW_ID);
  }, [local.micStream]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onJoin(n);
  };

  const mediaErrors = [local.micError, local.camError].filter(Boolean);
  const bothDenied = local.micError?.kind === 'denied' && local.camError?.kind === 'denied';
  const uniqueErrors = bothDenied
    ? [
        {
          kind: 'denied' as const,
          message:
            'Camera and microphone access is blocked. Click the lock/camera icon in the address bar, allow both, then try again.',
        },
      ]
    : [...new Map(mediaErrors.map((e) => [e!.message, e!])).values()];

  return (
    <div className="page prejoin-page">
      <div className="bg-glow" aria-hidden="true" />
      <header className="site-header">
        <BrandLink />
      </header>
      <main className="prejoin">
        <div className="prejoin-preview">
          <div className="preview-stage">
            {local.camStream ? (
              <VideoView stream={local.camStream} mirror={s.mirrorSelf} testId="prejoin-video" />
            ) : (
              <div className="preview-off">
                <Avatar name={name || 'You'} size={96} />
                <span className="muted">{local.camStarting ? 'Starting camera…' : 'Camera is off'}</span>
              </div>
            )}
            <div className="preview-name">{name || 'You'}</div>
            <div className="preview-controls">
              <button
                type="button"
                className={`round-btn ${local.micOn && local.mic ? '' : 'off'}`}
                onClick={() => local.setMicOn(!local.micOn)}
                aria-label={local.micOn ? 'Mute microphone' : 'Unmute microphone'}
                title={local.micOn ? 'Mute' : 'Unmute'}
                data-testid="prejoin-mic"
              >
                {local.micOn && local.mic ? <Mic size={22} /> : <MicOff size={22} />}
              </button>
              <button
                type="button"
                className={`round-btn ${local.camOn ? '' : 'off'}`}
                onClick={() => void local.setCamOn(!local.camOn)}
                aria-label={local.camOn ? 'Turn camera off' : 'Turn camera on'}
                title={local.camOn ? 'Camera off' : 'Camera on'}
                data-testid="prejoin-cam"
              >
                {local.camOn ? <Video size={22} /> : <VideoOff size={22} />}
              </button>
              <button type="button" className="round-btn" onClick={() => setShowSettings(true)} aria-label="Device settings" title="Settings">
                <SettingsIcon size={22} />
              </button>
            </div>
            {local.mic && local.micOn && (
              <div className="preview-meter">
                <LevelMeter id={PREVIEW_ID} />
              </div>
            )}
          </div>
          <div className="prejoin-devices">
            <DeviceSelect label="Microphone" icon={<Mic size={16} />} devices={mics} value={local.micId} onChange={(id) => void local.switchMic(id)} emptyText="No microphone" />
            <DeviceSelect label="Camera" icon={<Video size={16} />} devices={cams} value={local.camId} onChange={(id) => void local.switchCam(id)} emptyText="No camera" />
          </div>
        </div>

        <form className="prejoin-side" onSubmit={submit}>
          <h1>Ready to join?</h1>
          <button
            type="button"
            className="code-chip"
            onClick={async () => toast((await copyText(meetingUrl(code))) ? 'Meeting link copied' : 'Could not copy', 'success')}
            title="Copy meeting link"
          >
            <span className="mono">{code}</span> <Copy size={14} />
          </button>
          <label className="field">
            <span>Your name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 40))}
              placeholder="Enter your name"
              maxLength={40}
              required
              data-testid="name-input"
            />
          </label>
          {uniqueErrors.map((e) => (
            <div className="notice notice-warn" key={e!.message}>
              {e!.message}
              {e!.kind !== 'unsupported' && (
                <button type="button" className="btn btn-small" onClick={() => void local.retry()}>
                  Try again
                </button>
              )}
            </div>
          ))}
          {uniqueErrors.length > 0 && <p className="muted small">You can still join and listen, watch and chat.</p>}
          <button className="btn btn-primary btn-lg" type="submit" disabled={!name.trim()} data-testid="join-button">
            Join now
          </button>
          <p className="muted small">
            Anyone with the link can join. Video and audio go directly between participants, encrypted.
          </p>
        </form>
      </main>
      {showSettings && (
        <Modal title="Devices" onClose={() => setShowSettings(false)} wide>
          <DevicePanel local={local} section="all" />
        </Modal>
      )}
    </div>
  );
}
