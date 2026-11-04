import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Copy,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Settings as SettingsIcon,
  Users,
  Video,
  VideoOff,
  WifiOff,
} from 'lucide-react';
import type { MeetingSession } from '../rtc/MeetingSession';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useNow } from '../lib/hooks';
import { meetingUrl } from '../lib/meetingCode';
import { updateSettings, useSettings } from '../lib/settings';
import { setSoundsSink } from '../lib/sounds';
import { audioLevels } from '../lib/audioLevel';
import { Logo } from './Brand';
import { ChatPanel } from './ChatPanel';
import { Modal, Toggle } from './controls';
import { DevicePanel } from './DevicePanel';
import { RemoteAudio } from './media';
import { ParticipantsPanel } from './ParticipantsPanel';
import { copyText, useToast } from './Toast';
import { VideoGrid } from './VideoGrid';

function CtrlButton({
  icon,
  label,
  onClick,
  off,
  active,
  danger,
  badge,
  testId,
  className,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  off?: boolean;
  active?: boolean;
  danger?: boolean;
  badge?: number | string;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      className={`ctrl ${off ? 'off' : ''} ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className ?? ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      {icon}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

export function CallView({ session, local, onLeave }: { session: MeetingSession; local: LocalMedia; onLeave: () => void }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const s = useSettings();
  const toast = useToast();
  const now = useNow(15000);
  const root = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<'chat' | 'people' | null>(null);
  const [settingsTab, setSettingsTab] = useState<'audio' | 'video' | 'general' | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [seenOthers, setSeenOthers] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nameDraft, setNameDraft] = useState(s.displayName);

  const me = snap.participants[0];
  const remotes = snap.participants.slice(1);
  const othersMessages = snap.messages.filter((m) => !m.isLocal).length;
  const unread = panel === 'chat' ? 0 : Math.max(0, othersMessages - seenOthers);

  useEffect(() => {
    if (panel === 'chat') setSeenOthers(othersMessages);
  }, [panel, othersMessages]);

  // Speaking indicator for ourselves.
  useEffect(() => {
    audioLevels.watch(session.selfId, me.micStream);
  }, [session.selfId, me.micStream]);
  useEffect(() => () => audioLevels.unwatch(session.selfId), [session.selfId]);

  useEffect(() => {
    void setSoundsSink(s.speakerId);
  }, [s.speakerId]);

  // "X joined" / "X left" toasts.
  const prevIds = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const current = new Map(remotes.map((p) => [p.id, p.name]));
    const prev = prevIds.current;
    if (prev) {
      for (const [id, name] of current) if (!prev.has(id)) toast(`${name} joined`);
      for (const [id, name] of prev) if (!current.has(id)) toast(`${name} left`);
    }
    prevIds.current = current;
  }, [remotes, toast]);

  // A screen share or pin that disappeared shouldn't stay pinned.
  useEffect(() => {
    if (!pinned) return;
    const [id, kind] = pinned.split(':');
    const p = snap.participants.find((x) => x.id === id);
    if (!p || (kind === 'screen' && !p.screen)) setPinned(null);
  }, [pinned, snap.participants]);

  useEffect(() => {
    const on = () => setIsFullscreen(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  const toggleMic = useCallback(async () => {
    if (!local.mic) {
      local.micOn = true;
      await local.startMic(s.micId);
      if (local.micError) toast(local.micError.message, 'error');
      return;
    }
    local.setMicOn(!local.micOn);
  }, [local, s.micId, toast]);

  const toggleCam = useCallback(async () => {
    await local.setCamOn(!local.camOn);
    if (local.camOn === false && local.camError) toast(local.camError.message, 'error');
  }, [local, toast]);

  const toggleScreen = async () => {
    if (local.screen) {
      local.stopScreen();
      return;
    }
    const ok = await local.startScreen();
    if (!ok && local.screenError) toast(local.screenError.message, 'error');
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void root.current?.requestFullscreen().catch(() => toast('Fullscreen is not available here', 'error'));
  };

  const copyLink = async () => {
    toast((await copyText(meetingUrl(session.code))) ? 'Meeting link copied' : 'Could not copy', 'success');
  };

  // Ctrl/Cmd+D mute, Ctrl/Cmd+E camera (same muscle memory as other meeting apps).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === 'd') {
        e.preventDefault();
        void toggleMic();
      } else if (k === 'e') {
        e.preventDefault();
        void toggleCam();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleMic, toggleCam]);

  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);
  const unblockAudio = () => {
    document.querySelectorAll('audio').forEach((a) => void a.play().catch(() => {}));
    setAudioBlocked(false);
  };

  const signalDown = snap.signal !== 'connected';
  const micOn = local.micOn && !!local.mic;

  return (
    <div className={`call ${panel ? 'with-panel' : ''}`} ref={root} data-testid="call">
      <header className="call-top">
        <div className="call-brand">
          <Logo size={28} />
          <span className="brand-name hide-sm">Yapameet</span>
        </div>
        <button className="code-chip" onClick={() => void copyLink()} title="Copy meeting link" data-testid="copy-link">
          <span className="mono">{session.code}</span>
          <Copy size={14} />
        </button>
        <div className="call-top-right">
          <span
            className={`signal-dot sig-${snap.signal}`}
            title={`Signaling: ${snap.transport} (${snap.signal}${snap.signalDetail ? `, ${snap.signalDetail}` : ''})`}
            data-testid="signal-status"
            data-status={snap.signal}
          />
          <span className="hide-sm muted">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          <span className="count-chip" data-testid="participant-count">
            <Users size={14} /> {snap.participants.length}
          </span>
        </div>
      </header>

      <div className="call-body">
        <main className="call-stage">
          {signalDown && (
            <div className="banner banner-warn">
              <WifiOff size={16} />
              {snap.signal === 'error'
                ? `Can't reach the signaling service${snap.signalDetail ? ` (${snap.signalDetail})` : ''}. Retrying… People already connected stay connected.`
                : snap.signal === 'reconnecting'
                  ? 'Connection to the meeting service lost. Reconnecting…'
                  : 'Connecting to the meeting…'}
            </div>
          )}
          {audioBlocked && (
            <button className="banner banner-action" onClick={unblockAudio}>
              Your browser blocked call audio. Click here to enable sound.
            </button>
          )}
          {local.screen && (
            <div className="banner banner-info">
              <MonitorUp size={16} /> You are presenting to everyone
              <button className="btn btn-small btn-danger" onClick={() => local.stopScreen()} data-testid="stop-presenting">
                Stop presenting
              </button>
            </div>
          )}
          <VideoGrid participants={snap.participants} pinned={pinned} onPin={setPinned} mirrorSelf={s.mirrorSelf} showDetails={s.showConnectionDetails} />
        </main>
        {panel === 'chat' && (
          <ChatPanel messages={snap.messages} onSend={(t) => session.sendChat(t)} onClose={() => setPanel(null)} disabled={false} />
        )}
        {panel === 'people' && (
          <ParticipantsPanel participants={snap.participants} onClose={() => setPanel(null)} onCopyLink={() => void copyLink()} />
        )}
      </div>

      <footer className="call-controls">
        <div className="controls-left hide-sm">
          <span className="mono muted">{session.code}</span>
        </div>
        <div className="controls-center">
          <CtrlButton
            icon={micOn ? <Mic size={22} /> : <MicOff size={22} />}
            label={micOn ? 'Mute (Ctrl+D)' : 'Unmute (Ctrl+D)'}
            off={!micOn}
            onClick={() => void toggleMic()}
            testId="ctrl-mic"
          />
          <CtrlButton
            icon={local.camOn ? <Video size={22} /> : <VideoOff size={22} />}
            label={local.camOn ? 'Turn camera off (Ctrl+E)' : 'Turn camera on (Ctrl+E)'}
            off={!local.camOn}
            onClick={() => void toggleCam()}
            testId="ctrl-cam"
          />
          {local.canShareScreen && (
            <CtrlButton
              icon={local.screen ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
              label={local.screen ? 'Stop presenting' : 'Present your screen'}
              active={!!local.screen}
              onClick={() => void toggleScreen()}
              testId="ctrl-screen"
            />
          )}
          <CtrlButton
            icon={<SettingsIcon size={22} />}
            label="Settings"
            onClick={() => setSettingsTab('audio')}
            testId="ctrl-settings"
          />
          <CtrlButton
            icon={isFullscreen ? <Minimize size={22} /> : <Maximize size={22} />}
            label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={toggleFullscreen}
            className="hide-sm"
            testId="ctrl-fullscreen"
          />
          <CtrlButton icon={<PhoneOff size={22} />} label="Leave call" danger onClick={onLeave} testId="ctrl-leave" />
        </div>
        <div className="controls-right">
          <CtrlButton
            icon={<Users size={22} />}
            label="People"
            active={panel === 'people'}
            badge={remotes.length ? snap.participants.length : undefined}
            onClick={() => setPanel(panel === 'people' ? null : 'people')}
            testId="ctrl-people"
          />
          <CtrlButton
            icon={<MessageSquare size={22} />}
            label="Chat"
            active={panel === 'chat'}
            badge={unread ? (unread > 9 ? '9+' : unread) : undefined}
            onClick={() => setPanel(panel === 'chat' ? null : 'chat')}
            testId="ctrl-chat"
          />
        </div>
      </footer>

      {remotes.map((p) => (
        <span key={p.id} hidden>
          <RemoteAudio stream={p.micStream} sinkId={s.speakerId} onBlocked={onAudioBlocked} testId={`audio-${p.id}`} />
          <RemoteAudio stream={p.screenAudioStream} sinkId={s.speakerId} onBlocked={onAudioBlocked} />
        </span>
      ))}

      {settingsTab && (
        <Modal title="Settings" onClose={() => setSettingsTab(null)} wide>
          <div className="tabs" role="tablist">
            {(['audio', 'video', 'general'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={settingsTab === t} className={settingsTab === t ? 'active' : ''} onClick={() => setSettingsTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {settingsTab === 'general' ? (
            <div className="device-panel">
              <section className="panel-section">
                <label className="field">
                  <span>Display name</span>
                  <div className="row-with-button">
                    <input value={nameDraft} maxLength={40} onChange={(e) => setNameDraft(e.target.value)} />
                    <button
                      className="btn btn-small"
                      disabled={!nameDraft.trim() || nameDraft.trim() === me.name}
                      onClick={() => {
                        session.setName(nameDraft);
                        updateSettings({ displayName: nameDraft.trim() });
                        toast('Name updated', 'success');
                      }}
                    >
                      Save
                    </button>
                  </div>
                </label>
                <Toggle label="Join, leave and message sounds" checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
                <Toggle
                  label="Show connection details on tiles"
                  hint="Direct vs relayed and round-trip time"
                  checked={s.showConnectionDetails}
                  onChange={(v) => updateSettings({ showConnectionDetails: v })}
                />
                <p className="muted small">Signaling: {snap.transport}. Status: {snap.signal}{snap.signalDetail ? ` (${snap.signalDetail})` : ''}.</p>
              </section>
            </div>
          ) : (
            <DevicePanel local={local} section={settingsTab} />
          )}
        </Modal>
      )}
    </div>
  );
}
