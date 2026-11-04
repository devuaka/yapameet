import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  Copy,
  Hand,
  Maximize,
  MessageSquare,
  Mic,
  MicOff,
  Minimize,
  MonitorOff,
  MonitorUp,
  PhoneOff,
  Settings as SettingsIcon,
  SmilePlus,
  Sparkles,
  Users,
  Video,
  VideoOff,
  WifiOff,
  Wand2,
} from 'lucide-react';
import type { ChatMessage, MeetingSession, SessionEvent } from '../rtc/MeetingSession';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useNow } from '../lib/hooks';
import { meetingUrl } from '../lib/meetingCode';
import { findEgg, updateSettings, useSettings } from '../lib/settings';
import { setSoundsSink, sounds } from '../lib/sounds';
import { audioLevels } from '../lib/audioLevel';
import { callState, fxBus, useKonami } from '../lib/fx';
import { Logo } from './Brand';
import { ChatPanel } from './ChatPanel';
import { Modal, Toggle } from './controls';
import { AppearancePanel, AudioPanel, EffectsPanel, MeetingPanel, VideoPanel } from './SettingsPanels';
import { GhostDialog } from './GhostDialog';
import { RemoteAudio } from './media';
import { ParticipantsPanel } from './ParticipantsPanel';
import { ToolsPanel } from './ToolsPanel';
import { ReactionLayer, ReactionPicker, type FloatingReaction } from './Reactions';
import { copyText, useToast } from './Toast';
import { VideoGrid } from './VideoGrid';

type SettingsTab = 'audio' | 'video' | 'effects' | 'appearance' | 'meeting' | 'general';

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
  text,
}: {
  text?: string;
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
      className={`ctrl ${text ? 'with-text' : ''} ${off ? 'off' : ''} ${active ? 'active' : ''} ${danger ? 'danger' : ''} ${className ?? ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
      data-testid={testId}
    >
      {icon}
      {text && <span className="ctrl-text">{text}</span>}
      {badge ? <span className="badge">{badge}</span> : null}
    </button>
  );
}

const isTyping = (el: Element | null) =>
  !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable);

export function CallView({ session, local, onLeave }: { session: MeetingSession; local: LocalMedia; onLeave: () => void }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const s = useSettings();
  const toast = useToast();
  const now = useNow(15000);
  const root = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<'chat' | 'people' | 'tools' | null>(null);
  const [settingsTab, setSettingsTab] = useState<SettingsTab | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [seenOthers, setSeenOthers] = useState(0);
  const [audioBlocked, setAudioBlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [nameDraft, setNameDraft] = useState(s.displayName);
  const [picker, setPicker] = useState(false);
  const [floating, setFloating] = useState<FloatingReaction[]>([]);
  const [ghostOpen, setGhostOpen] = useState(false);
  const [ptt, setPtt] = useState(false);
  const [activeSpeaker, setActiveSpeaker] = useState<string | null>(null);
  const reactionId = useRef(0);
  const [typers, setTypers] = useState<Record<string, { name: string; until: number }>>({});
  const [preview, setPreview] = useState<ChatMessage | null>(null);
  const pttRef = useRef(false);
  pttRef.current = ptt;

  const me = snap.participants[0];
  const remotes = snap.participants.slice(1);
  const othersMessages = snap.messages.filter((m) => !m.isLocal).length;
  const unread = panel === 'chat' ? 0 : Math.max(0, othersMessages - seenOthers);

  useEffect(() => {
    callState.active = true;
    return () => {
      callState.active = false;
    };
  }, []);

  useEffect(() => {
    if (panel === 'chat') setSeenOthers(othersMessages);
  }, [panel, othersMessages]);

  // Speaking indicator (and "you're muted" detection) use an always-on clone of the mic.
  useEffect(() => {
    audioLevels.watch(session.selfId, local.micMonitorStream);
  }, [session.selfId, local.micMonitorStream]);
  useEffect(() => () => audioLevels.unwatch(session.selfId), [session.selfId]);

  useEffect(() => {
    void setSoundsSink(s.speakerId);
  }, [s.speakerId]);

  // Join/leave toasts.
  const prevIds = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const current = new Map(remotes.filter((p) => !p.leaving).map((p) => [p.id, p.name]));
    const prev = prevIds.current;
    if (prev) {
      for (const [id, name] of current) if (!prev.has(id)) toast(`${name} joined`);
      for (const [id, name] of prev) if (!current.has(id)) toast(`${name} left`);
    }
    prevIds.current = current;
  }, [remotes, toast]);

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

  // Active speaker (for the Speaker layout): loudest remote, held for a moment to avoid flicker.
  useEffect(() => {
    let current: string | null = null;
    let since = 0;
    const t = window.setInterval(() => {
      let best: string | null = null;
      let bestLevel = 0;
      for (const p of remotes) {
        if (!p.audio || !audioLevels.speaking(p.id)) continue;
        const l = audioLevels.level(p.id);
        if (l > bestLevel) {
          best = p.id;
          bestLevel = l;
        }
      }
      if (best && best !== current && performance.now() - since > 1500) {
        current = best;
        since = performance.now();
        setActiveSpeaker(best);
      }
    }, 300);
    return () => clearInterval(t);
  }, [remotes]);

  // "You're muted" nudge: talking for a while with the mic off.
  useEffect(() => {
    if (!s.mutedWarning) return;
    // Sliding 3 s window: speech has pauses, so count how much of the window had voice.
    const window3s: boolean[] = [];
    let lastWarn = 0;
    const t = window.setInterval(() => {
      if (local.micOn || !local.mic) {
        window3s.length = 0;
        return;
      }
      window3s.push(audioLevels.speaking(session.selfId));
      if (window3s.length > 12) window3s.shift();
      const voiced = window3s.filter(Boolean).length;
      if (voiced >= 5 && Date.now() - lastWarn > 20000) {
        lastWarn = Date.now();
        window3s.length = 0;
        toast(s.pushToTalk ? "You're muted. Press Ctrl+D, or hold Space to talk." : "You're muted. Press Ctrl+D to unmute.");
      }
    }, 250);
    return () => clearInterval(t);
  }, [s.mutedWarning, s.pushToTalk, local, session.selfId, toast]);

  // Session events: reactions, hands, effects.
  useEffect(
    () =>
      session.onEvent((e: SessionEvent) => {
        if (e.type === 'typing') {
          setTypers((t) => ({ ...t, [e.from]: { name: e.name, until: Date.now() + 4000 } }));
          return;
        }
        if (e.type === 'react') {
          if (!s.reactionsFloat) {
            if (!e.isLocal) toast(`${e.name} reacted ${e.emoji}`);
            return;
          }
          const id = ++reactionId.current;
          setFloating((list) => [...list.slice(-30), { id, emoji: e.emoji, name: e.isLocal ? 'You' : e.name, x: 4 + Math.random() * 22 }]);
          window.setTimeout(() => setFloating((list) => list.filter((r) => r.id !== id)), 3800);
          sounds.pop();
        } else if (e.type === 'hand' && !e.isLocal) {
          if (e.up) {
            toast(`✋ ${e.name} raised their hand`);
            sounds.hand();
          }
        } else if (e.type === 'fx') {
          fxBus.emit(e.fx, e.name);
          if (!e.isLocal && e.fx === 'barrelroll') toast(`${e.name} did a barrel roll`);
          if (!e.isLocal && e.fx === 'party') toast(`🪩 ${e.name} started a party`);
        }
      }),
    [session, toast, s.reactionsFloat],
  );

  // Typing indicators expire on their own; a sent message clears its author.
  useEffect(() => {
    const t = window.setInterval(() => {
      setTypers((cur) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(cur).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(cur).length ? cur : next;
      });
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // New-message preview bubble while the chat is closed.
  const lastMsgId = useRef<string | null>(null);
  useEffect(() => {
    const last = snap.messages[snap.messages.length - 1];
    if (!last || last.id === lastMsgId.current) return;
    lastMsgId.current = last.id;
    if (last.isLocal) return;
    setTypers((t) => {
      if (!t[last.from]) return t;
      const { [last.from]: _gone, ...rest } = t;
      return rest;
    });
    if (panel === 'chat') return;
    setPreview(last);
    const timer = window.setTimeout(() => setPreview((p) => (p?.id === last.id ? null : p)), 5000);
    return () => clearTimeout(timer);
  }, [snap.messages, panel]);
  useEffect(() => {
    if (panel === 'chat') setPreview(null);
  }, [panel]);

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

  const toggleHand = useCallback(() => {
    session.setHand(!session.hand);
    if (session.hand) sounds.hand();
  }, [session]);

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

  // Keyboard: Ctrl+D mic, Ctrl+E camera, Ctrl+Alt+H hand, Ctrl+Alt+C chat, hold Space = push to talk.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && e.altKey && !e.shiftKey) {
        if (k === 'h') {
          e.preventDefault();
          toggleHand();
        } else if (k === 'c') {
          e.preventDefault();
          setPanel((p) => (p === 'chat' ? null : 'chat'));
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey) {
        if (k === 'd') {
          e.preventDefault();
          void toggleMic();
        } else if (k === 'e') {
          e.preventDefault();
          void toggleCam();
        }
        return;
      }
      if (e.code === 'Space' && !e.repeat && s.pushToTalk && !isTyping(document.activeElement) && document.activeElement?.tagName !== 'BUTTON') {
        if (!local.micOn && local.mic) {
          e.preventDefault();
          local.setMicOn(true);
          setPtt(true);
        }
      }
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === 'Space' && pttRef.current) {
        local.setMicOn(false);
        setPtt(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onUp);
    };
  }, [toggleMic, toggleCam, toggleHand, s.pushToTalk, local]);
  useEffect(() => {
    const blur = () => {
      if (pttRef.current) {
        local.setMicOn(false);
        setPtt(false);
      }
    };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [local]);

  // Easter egg: Konami code in a call sends confetti to everyone.
  useKonami(useCallback(() => session.sendFx('confetti'), [session]));

  // Easter egg: triple-click the logo to open Ghost Protocol.
  const logoClicks = useRef<number[]>([]);
  const onLogoClick = () => {
    const t = Date.now();
    logoClicks.current = [...logoClicks.current.filter((x) => t - x < 900), t];
    if (logoClicks.current.length >= 3) {
      logoClicks.current = [];
      if (findEgg('ghost')) {
        sounds.secret();
        toast('👻 Secret found: Ghost Protocol', 'success');
      }
      setGhostOpen(true);
    }
  };

  // Chat with slash commands (and a couple of hidden ones).
  const onSend = (raw: string) => {
    const text = raw.trim();
    if (/do a barrel roll/i.test(text)) {
      session.sendChat(text);
      session.sendFx('barrelroll');
      if (findEgg('barrelroll')) {
        sounds.secret();
        toast('🛩️ Secret found: Barrel Roll', 'success');
      }
      return;
    }
    if (!text.startsWith('/')) {
      session.sendChat(text);
      return;
    }
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(' ');
    switch (cmd.toLowerCase()) {
      case 'help':
        session.addNote(
          'Commands: /shrug [text], /flip, /unflip, /roll [sides], /coin, /me <action>, /confetti, /hand, /clear. Some commands are secret.',
        );
        break;
      case 'shrug':
        session.sendChat(`${arg ? `${arg} ` : ''}¯\\_(ツ)_/¯`);
        break;
      case 'flip':
        session.sendChat('(╯°□°)╯︵ ┻━┻');
        break;
      case 'unflip':
        session.sendChat('┬─┬ノ( º _ ºノ)');
        break;
      case 'roll': {
        const sides = Math.min(1000, Math.max(2, parseInt(arg, 10) || 6));
        session.sendChat(`🎲 rolled ${1 + Math.floor(Math.random() * sides)} (1-${sides})`);
        break;
      }
      case 'coin':
        session.sendChat(`🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`);
        break;
      case 'me':
        if (arg) session.sendChat(`* ${me.name} ${arg}`);
        break;
      case 'confetti':
        session.sendFx('confetti');
        break;
      case 'hand':
        toggleHand();
        break;
      case 'clear':
        session.addNote('Only you can clear your own view: messages from others stay until you leave.');
        break;
      case 'party':
        session.sendFx('party');
        if (findEgg('party')) {
          sounds.secret();
          toast('🪩 Secret found: Party Mode', 'success');
        }
        break;
      default:
        session.addNote(`Unknown command /${cmd}. Type /help.`);
    }
  };

  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);
  const unblockAudio = () => {
    document.querySelectorAll('audio').forEach((a) => void a.play().catch(() => {}));
    setAudioBlocked(false);
  };

  const signalDown = snap.signal !== 'connected';
  const micOn = local.micOn && !!local.mic;
  const effectsOn = s.bgEffect !== 'none' || s.filter !== 'none' || s.lowLightBoost;
  const hands = snap.participants.filter((p) => p.hand).length;

  return (
    <div className={`call ${panel ? 'with-panel' : ''} ${s.compactTiles ? 'compact' : ''}`} ref={root} data-testid="call">
      <header className="call-top">
        <button className="call-brand" onClick={onLogoClick} aria-label="Yapameet" title="Yapameet" data-testid="call-logo">
          <Logo size={28} />
          <span className="brand-name hide-sm">Yapameet</span>
        </button>
        <button className="code-chip" onClick={() => void copyLink()} title="Copy meeting link" data-testid="copy-link">
          <span className="mono">{session.code}</span>
          <Copy size={14} />
        </button>
        <div className="call-top-right">
          {hands > 0 && (
            <span className="count-chip hand-chip" title="Raised hands">
              <Hand size={14} /> {hands}
            </span>
          )}
          <span
            className={`signal-dot sig-${snap.signal}`}
            title={`Signaling: ${snap.transport} (${snap.signal}${snap.signalDetail ? `, ${snap.signalDetail}` : ''})`}
            data-testid="signal-status"
            data-status={snap.signal}
          />
          {s.showClock && <span className="hide-sm muted">{new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}
          <span className="count-chip" data-testid="participant-count">
            <Users size={14} /> {snap.participants.filter((p) => !p.leaving).length}
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
          <VideoGrid
            participants={snap.participants}
            pinned={pinned}
            onPin={setPinned}
            mirrorSelf={s.mirrorSelf}
            showDetails={s.showConnectionDetails}
            layout={s.layout}
            activeSpeaker={activeSpeaker}
            hideSelf={s.hideSelfView}
            compact={s.compactTiles}
          />
          <ReactionLayer items={floating} />
          {preview && panel !== 'chat' && (
            <button className="chat-preview" onClick={() => setPanel('chat')} data-testid="chat-preview">
              <span className="chat-preview-name">
                <MessageSquare size={14} /> {preview.name}
              </span>
              <span className="chat-preview-text">{preview.text}</span>
            </button>
          )}
          {ptt && (
            <div className="ptt-indicator" data-testid="ptt">
              <Mic size={16} /> Talking (push to talk)
            </div>
          )}
        </main>
        {panel === 'chat' && <ChatPanel
            messages={snap.messages}
            onSend={onSend}
            onClose={() => setPanel(null)}
            disabled={false}
            typers={Object.values(typers).map((t) => t.name)}
            onTyping={() => session.sendTyping()}
          />}
        {panel === 'tools' && <ToolsPanel session={session} local={local} onClose={() => setPanel(null)} onGhost={() => setGhostOpen(true)} />}
        {panel === 'people' && (
          <ParticipantsPanel participants={snap.participants.filter((p) => !p.leaving)} onClose={() => setPanel(null)} onCopyLink={() => void copyLink()} />
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
          <CtrlButton
            icon={<Sparkles size={22} />}
            label="Backgrounds & filters"
            active={effectsOn}
            onClick={() => setSettingsTab('effects')}
            testId="ctrl-effects"
          />
          {local.canShareScreen && (
            <CtrlButton
              icon={local.screen ? <MonitorOff size={22} /> : <MonitorUp size={22} />}
              label={local.screen ? 'Stop presenting' : 'Present your screen'}
              active={!!local.screen}
              onClick={() => void toggleScreen()}
              testId="ctrl-screen"
              className="hide-xs"
            />
          )}
          <div className="react-wrap">
            <CtrlButton icon={<SmilePlus size={22} />} label="Send a reaction" active={picker} onClick={() => setPicker((v) => !v)} testId="ctrl-react" />
            {picker && (
              <ReactionPicker
                onPick={(e) => {
                  session.react(e);
                }}
                onClose={() => setPicker(false)}
              />
            )}
          </div>
          <CtrlButton
            icon={<Hand size={22} />}
            label={session.hand ? 'Lower hand (Ctrl+Alt+H)' : 'Raise hand (Ctrl+Alt+H)'}
            active={me.hand}
            onClick={toggleHand}
            testId="ctrl-hand"
          />
          <CtrlButton icon={<SettingsIcon size={22} />} label="Settings" onClick={() => setSettingsTab('audio')} testId="ctrl-settings" className="hide-xs" />
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
            icon={<Wand2 size={22} />}
            label="Tools: soundboard & fun"
            text="Tools"
            active={panel === 'tools'}
            badge={local.playingSounds.size ? '♪' : undefined}
            onClick={() => setPanel(panel === 'tools' ? null : 'tools')}
            testId="ctrl-tools"
          />
          <CtrlButton
            icon={<Users size={22} />}
            label="People"
            text="People"
            active={panel === 'people'}
            badge={remotes.length ? snap.participants.length : undefined}
            onClick={() => setPanel(panel === 'people' ? null : 'people')}
            testId="ctrl-people"
          />
          <CtrlButton
            icon={<MessageSquare size={22} />}
            label="Chat (Ctrl+Alt+C)"
            text="Chat"
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
          <div className="tabs tabs-scroll" role="tablist">
            {(['audio', 'video', 'effects', 'appearance', 'meeting', 'general'] as const).map((t) => (
              <button key={t} role="tab" aria-selected={settingsTab === t} className={settingsTab === t ? 'active' : ''} onClick={() => setSettingsTab(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          {settingsTab === 'audio' && <AudioPanel local={local} />}
          {settingsTab === 'video' && <VideoPanel local={local} />}
          {settingsTab === 'effects' && <EffectsPanel local={local} />}
          {settingsTab === 'appearance' && <AppearancePanel />}
          {settingsTab === 'meeting' && <MeetingPanel />}
          {settingsTab === 'general' && (
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
                <Toggle
                  label="Show connection stats on tiles"
                  hint="Resolution, fps, bitrate, delay and codec"
                  checked={s.showConnectionDetails}
                  onChange={(v) => updateSettings({ showConnectionDetails: v })}
                />
                <p className="muted small">
                  Signaling: {snap.transport}. Status: {snap.signal}
                  {snap.signalDetail ? ` (${snap.signalDetail})` : ''}.
                </p>
              </section>
            </div>
          )}
        </Modal>
      )}

      {ghostOpen && <GhostDialog local={local} session={session} onClose={() => setGhostOpen(false)} />}
    </div>
  );
}
