import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy, Mic, MicOff, QrCode as QrIcon, Settings as SettingsIcon, Sparkles, Video, VideoOff } from 'lucide-react';
import { BrandLink } from './Brand';
import { Avatar, DeviceSelect, Modal } from './controls';
import { SettingsView, type SettingsSection } from './SettingsPanels';
import { QrCode } from './MeetingInfo';
import { usePfp } from '../lib/pfp';
import { usePeek } from '../lib/peek';
import { GABEN_NAME, isGabenCode } from '../lib/gaben';
import { LevelMeter, VideoView } from './media';
import { copyText, useToast } from './Toast';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useEmitter } from '../lib/hooks';
import { meetingUrl } from '../lib/meetingCode';
import { updateSettings, useSettings } from '../lib/settings';
import { audioLevels } from '../lib/audioLevel';

const PREVIEW_ID = '__prejoin-mic';

/** The lobby: check camera and mic, set a name, invite people, then join. */
export function PreJoin({ code, local, onJoin }: { code: string; local: LocalMedia; onJoin: (name: string) => void }) {
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const name = s.displayName;
  const [settings, setSettings] = useState<SettingsSection | null>(null);
  const [qr, setQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const pfp = usePfp();
  const peeked = usePeek(code);
  const here = isGabenCode(code) && peeked ? [GABEN_NAME, ...peeked] : peeked;
  const mics = local.devices.filter((d) => d.kind === 'audioinput');
  const cams = local.devices.filter((d) => d.kind === 'videoinput');
  const link = meetingUrl(code);

  useEffect(() => {
    audioLevels.watch(PREVIEW_ID, local.micMonitorStream);
    return () => audioLevels.unwatch(PREVIEW_ID);
  }, [local.micMonitorStream]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (n) onJoin(n);
  };

  const copy = async () => {
    const ok = await copyText(link);
    toast(ok ? 'Meeting link copied' : 'Could not copy', 'success');
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const mediaErrors = [local.micError, local.camError].filter(Boolean);
  const bothDenied = local.micError?.kind === 'denied' && local.camError?.kind === 'denied';
  const uniqueErrors = bothDenied
    ? [
        {
          kind: 'denied' as const,
          message: 'Camera and microphone access is blocked. Click the lock/camera icon in the address bar, allow both, then try again.',
        },
      ]
    : [...new Map(mediaErrors.map((e) => [e!.message, e!])).values()];
  const micOn = local.micOn && !!local.mic;
  const fxOn = s.bgEffect !== 'none' || s.filter !== 'none' || s.lowLightBoost || s.sticker !== 'none';

  return (
    <div className="page prejoin-page">
      <div className="bg-glow" aria-hidden="true" />
      <header className="site-header">
        <BrandLink />
      </header>
      <main className="prejoin">
        <section className="prejoin-preview">
          <div className="preview-stage">
            {local.camStream ? (
              <VideoView stream={local.camStream} mirror={s.mirrorSelf} testId="prejoin-video" />
            ) : (
              <div className="preview-off">
                <button type="button" className="pfp-hit" onClick={() => setSettings('profile')} title="Change profile picture" data-testid="prejoin-pfp">
                  <Avatar name={name || 'You'} size={104} src={pfp} />
                </button>
                <span>{local.camStarting ? 'Starting camera…' : 'Camera is off'}</span>
              </div>
            )}
            <div className="preview-name">
              {micOn && <LevelMeter id={PREVIEW_ID} bars={5} />}
              {!micOn && <MicOff size={14} />}
              <span>{name || 'You'}</span>
            </div>
            <div className="preview-controls">
              <button
                type="button"
                className={`round-btn ${micOn ? '' : 'off'}`}
                onClick={() => local.setMicOn(!local.micOn)}
                aria-label={local.micOn ? 'Mute microphone' : 'Unmute microphone'}
                title={local.micOn ? 'Mute' : 'Unmute'}
                data-testid="prejoin-mic"
              >
                {micOn ? <Mic size={22} /> : <MicOff size={22} />}
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
              <button
                type="button"
                className={`round-btn ${fxOn ? 'fx-on' : ''}`}
                onClick={() => setSettings('effects')}
                aria-label="Backgrounds and effects"
                title="Backgrounds & effects"
                data-testid="prejoin-effects"
              >
                <Sparkles size={22} />
              </button>
              <button type="button" className="round-btn" onClick={() => setSettings('audio')} aria-label="Settings" title="Settings" data-testid="prejoin-settings">
                <SettingsIcon size={22} />
              </button>
            </div>
          </div>
          <div className="prejoin-devices">
            <DeviceSelect label="Microphone" icon={<Mic size={16} />} devices={mics} value={local.micId} onChange={(id) => void local.switchMic(id)} emptyText="No microphone" />
            <DeviceSelect label="Camera" icon={<Video size={16} />} devices={cams} value={local.camId} onChange={(id) => void local.switchCam(id)} emptyText="No camera" />
          </div>
        </section>

        <form className="prejoin-side card" onSubmit={submit}>
          <span className="eyebrow mono">{code}</span>
          <h1>Ready to join?</h1>
          <div className="here-line">
            {here && here.length > 0 && (
              <span className="here-avatars" aria-hidden="true">
                {here.slice(0, 4).map((n, i) => (
                  <Avatar key={`${n}-${i}`} name={n} size={26} />
                ))}
              </span>
            )}
            <span data-testid="whos-here">
              {here === null ? (
                <span className="muted">Checking who's here…</span>
              ) : here.length === 0 ? (
                <span className="muted">No one else is here yet</span>
              ) : here.length === 1 ? (
                `${here[0]} is in this call`
              ) : here.length === 2 ? (
                `${here[0]} and ${here[1]} are in this call`
              ) : (
                `${here.slice(0, 2).join(', ')} and ${here.length - 2} more are in this call`
              )}
            </span>
          </div>
          <label className="field">
            <span>Your name</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => updateSettings({ displayName: e.target.value.slice(0, 40) })}
              placeholder="What should people call you?"
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
          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={!name.trim()} data-testid="join-button">
            Join now
          </button>

          <div className="invite">
            <span className="invite-title">Invite people</span>
            <div className="link-box">
              <span className="link-text" data-testid="invite-link">
                {link}
              </span>
              <button type="button" className="icon-btn" onClick={() => void copy()} aria-label="Copy meeting link" title="Copy link" data-testid="invite-copy">
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
              <button type="button" className={`icon-btn ${qr ? '' : 'ghost'}`} onClick={() => setQr((v) => !v)} aria-label="Show QR code" title="QR code for phones" data-testid="invite-qr">
                <QrIcon size={16} />
              </button>
            </div>
            {qr && (
              <div className="invite-qr">
                <QrCode text={link} size={116} testId="invite-qr-img" />
                <span className="muted small">Scan with a phone camera to join from there.</span>
              </div>
            )}
          </div>
          <p className="muted small prejoin-note">Anyone with the link can join. Video and audio go directly between people, encrypted.</p>
        </form>
      </main>
      {settings && (
        <Modal title="Settings" onClose={() => setSettings(null)} size="xl">
          <SettingsView local={local} section={settings} onSection={setSettings} />
        </Modal>
      )}
    </div>
  );
}
