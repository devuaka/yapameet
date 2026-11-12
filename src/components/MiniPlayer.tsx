import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ArrowUpLeft, Hand, Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import type { MeetingSession, Participant } from '../rtc/MeetingSession';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useEmitter } from '../lib/hooks';
import { audioLevels } from '../lib/audioLevel';
import { getSettings, useSettings } from '../lib/settings';
import { Avatar } from './controls';
import { VideoView, useSpeaking } from './media';

interface DocumentPiP {
  requestWindow(opts?: { width?: number; height?: number; disallowReturnToOpener?: boolean; preferInitialWindowPlacement?: boolean }): Promise<Window>;
  window: Window | null;
}
const docPip = () => (window as unknown as { documentPictureInPicture?: DocumentPiP }).documentPictureInPicture;

export const miniPlayerSupported = () => !!docPip() || ('pictureInPictureEnabled' in document && document.pictureInPictureEnabled);

function MiniTile({ p, small }: { p: Participant; small?: boolean }) {
  const speaking = useSpeaking(p.id) && p.audio;
  const s = useSettings();
  const stream = p.screen && !small ? p.screenStream : p.camStream;
  const on = !!stream && (p.screen && !small ? true : p.video);
  return (
    <div className={`mini-tile ${small ? 'mini-self' : ''} ${speaking ? 'speaking' : ''}`}>
      {on ? (
        <VideoView stream={stream} mirror={p.isLocal && !p.screen && s.mirrorSelf} fit={p.screen && !small ? 'contain' : 'cover'} />
      ) : (
        <div className="tile-avatar">
          <Avatar name={p.name} size={small ? 32 : 64} src={p.pfp ?? p.botImage} />
        </div>
      )}
      {!small && (
        <div className="tile-label">
          {!p.audio && <MicOff size={12} className="mic-off" />}
          <span>{p.isLocal ? `${p.name} (You)` : p.name}</span>
        </div>
      )}
    </div>
  );
}

/** The floating mini player UI (rendered in its own React root inside the PiP window). */
function MiniPlayerView({ session, local, onBack, onLeave }: { session: MeetingSession; local: LocalMedia; onBack: () => void; onLeave: () => void }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  useEmitter(local);
  const [speaker, setSpeaker] = useState<string | null>(null);
  const me = snap.participants[0];
  const remotes = snap.participants.slice(1).filter((p) => !p.leaving);

  useEffect(() => {
    const t = window.setInterval(() => {
      let best: string | null = null;
      let lvl = 0;
      for (const p of remotes) {
        const l = p.audio && audioLevels.speaking(p.id) ? audioLevels.level(p.id) : 0;
        if (l > lvl) {
          lvl = l;
          best = p.id;
        }
      }
      if (best) setSpeaker(best);
    }, 400);
    return () => clearInterval(t);
  }, [remotes]);

  const main = remotes.find((p) => p.screen) ?? remotes.find((p) => p.id === speaker) ?? remotes[0] ?? me;
  const micOn = local.micOn && !!local.mic;

  return (
    <div className="mini-player" data-testid="mini-player">
      <MiniTile p={main} />
      {main !== me && <MiniTile p={me} small />}
      <button className="mini-back" onClick={onBack} title="Back to the call tab" data-testid="mini-back">
        <ArrowUpLeft size={14} /> Back to call
      </button>
      <span className="mini-count">{remotes.length + 1} in call</span>
      <div className="mini-controls">
        <button className={`mini-btn ${micOn ? '' : 'off'}`} onClick={() => local.setMicOn(!local.micOn)} title={micOn ? 'Mute' : 'Unmute'} data-testid="mini-mic">
          {micOn ? <Mic size={18} /> : <MicOff size={18} />}
        </button>
        <button className={`mini-btn ${local.camOn ? '' : 'off'}`} onClick={() => void local.setCamOn(!local.camOn)} title="Camera" data-testid="mini-cam">
          {local.camOn ? <Video size={18} /> : <VideoOff size={18} />}
        </button>
        <button className={`mini-btn ${me.hand ? 'active' : ''}`} onClick={() => session.setHand(!session.hand)} title="Raise hand">
          <Hand size={18} />
        </button>
        <button className="mini-btn danger" onClick={onLeave} title="Leave call" data-testid="mini-leave">
          <PhoneOff size={18} />
        </button>
      </div>
    </div>
  );
}

function copyStyles(target: Document) {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href) {
        const link = target.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        target.head.appendChild(link);
      } else {
        const style = target.createElement('style');
        style.textContent = Array.from(sheet.cssRules)
          .map((r) => r.cssText)
          .join('\n');
        target.head.appendChild(style);
      }
    } catch {
      /* cross-origin sheet: skip */
    }
  }
}

/**
 * Mini player: a Document Picture-in-Picture window. Chrome/Edge open it
 * automatically when you switch tabs during a call (Media Session
 * "enterpictureinpicture"), the same way Meet does; it closes when you return.
 */
export function useMiniPlayer(session: MeetingSession, local: LocalMedia, onLeave: () => void) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<Root | null>(null);
  const winRef = useRef<Window | null>(null);
  const leaveRef = useRef(onLeave);
  leaveRef.current = onLeave;

  const close = useCallback(() => {
    winRef.current?.close();
  }, []);

  const openMini = useCallback(async () => {
    const api = docPip();
    if (!api) {
      // Fallback: classic video picture-in-picture of the main video.
      const v =
        document.querySelector<HTMLVideoElement>('.spotlight-main video, .stage-duo > .tile video, [data-testid="tile-remote-cam"] video') ??
        document.querySelector<HTMLVideoElement>('[data-testid="tile-local-cam"] video');
      if (v && document.pictureInPictureEnabled && !document.pictureInPictureElement) await v.requestPictureInPicture().catch(() => {});
      return;
    }
    if (api.window) return;
    try {
      const w = await api.requestWindow({ width: 380, height: 250 });
      winRef.current = w;
      copyStyles(w.document);
      w.document.title = `${session.code} · Yapameet`;
      w.document.documentElement.dataset.theme = document.documentElement.dataset.theme ?? 'midnight';
      w.document.body.className = 'mini-body';
      const host = w.document.createElement('div');
      host.className = 'mini-root';
      w.document.body.appendChild(host);
      const root = createRoot(host);
      rootRef.current = root;
      root.render(
        <MiniPlayerView
          session={session}
          local={local}
          onBack={() => {
            window.focus();
            w.close();
          }}
          onLeave={() => {
            w.close();
            leaveRef.current();
          }}
        />,
      );
      w.addEventListener('pagehide', () => {
        root.unmount();
        rootRef.current = null;
        winRef.current = null;
        setOpen(false);
      });
      setOpen(true);
    } catch (err) {
      console.warn('[yapameet] mini player unavailable', err);
    }
  }, [session, local]);

  // Auto-open when the user switches away (Chrome/Edge 134+ for camera/mic calls).
  useEffect(() => {
    const ms = navigator.mediaSession as MediaSession | undefined;
    if (!ms) return;
    try {
      ms.setActionHandler('enterpictureinpicture' as MediaSessionAction, () => {
        if (getSettings().autoMiniPlayer) void openMini();
      });
    } catch {
      /* action not supported in this browser */
    }
    return () => {
      try {
        ms.setActionHandler('enterpictureinpicture' as MediaSessionAction, null);
      } catch {
        /* ignore */
      }
    };
  }, [openMini]);

  // Back on the tab: close it, like Meet.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && winRef.current) winRef.current.close();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  useEffect(() => () => winRef.current?.close(), []);

  return { open, openMini, close };
}
