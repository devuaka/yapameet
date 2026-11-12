import { memo, useEffect, useRef, useState } from 'react';
import { Ghost, Hand, Loader2, Maximize2, MicOff, MonitorUp, PictureInPicture2, Pin, PinOff, Radio, WifiOff } from 'lucide-react';
import type { Participant } from '../rtc/MeetingSession';
import { Avatar } from './controls';
import { ThrowPicker } from './GameUI';
import type { ThrowId } from '../rtc/games';
import { VideoView, useSpeaking } from './media';

export interface Tile {
  key: string;
  kind: 'cam' | 'screen';
  p: Participant;
}

export const VideoTile = memo(function VideoTile({
  tile,
  pinned,
  onPin,
  mirrorSelf,
  showDetails,
  style,
  compact,
  onThrow,
}: {
  onThrow?: (target: string, item: ThrowId) => void;
  tile: Tile;
  pinned: boolean;
  onPin: (key: string | null) => void;
  mirrorSelf: boolean;
  showDetails: boolean;
  style?: React.CSSProperties;
  compact?: boolean;
}) {
  const { p, kind } = tile;
  const box = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const freeze = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState(false);
  const [throwing, setThrowing] = useState(false);
  const speaking = useSpeaking(p.id) && p.audio && kind === 'cam' && !p.leaving;
  const stream = kind === 'cam' ? p.camStream : p.screenStream;
  const showVideo = !!stream && (kind === 'cam' ? p.video : p.screen);
  const ghosting = p.leaving && kind === 'cam' && !!p.roomPhoto;
  const label =
    kind === 'screen' ? `${p.isLocal ? 'You are' : `${p.name} is`} presenting` : p.leaving ? `${p.name} left` : p.isLocal ? `${p.name} (You)` : p.name;

  // Ghost mode: freeze the last frame so we can dissolve it into the empty room.
  useEffect(() => {
    if (!ghosting) return;
    const v = video.current;
    const c = freeze.current;
    if (v && c && v.videoWidth) {
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')?.drawImage(v, 0, 0);
    }
    setFrozen(true);
  }, [ghosting]);

  const fullscreen = () => {
    if (document.fullscreenElement === box.current) void document.exitFullscreen();
    else void box.current?.requestFullscreen().catch(() => {});
  };
  const pip = async () => {
    const v = video.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement === v) await document.exitPictureInPicture();
      else await v.requestPictureInPicture();
    } catch {
      /* not allowed right now */
    }
  };

  const st = p.stats;
  return (
    <div
      ref={box}
      className={`tile ${speaking ? 'speaking' : ''} ${kind === 'screen' ? 'tile-screen' : ''} ${compact ? 'compact' : ''} ${
        p.leaving ? (ghosting ? 'ghosting' : 'leaving') : ''
      } ${p.hand && kind === 'cam' ? 'hand-up' : ''}`}
      style={style}
      data-testid={`tile-${p.isLocal ? 'local' : 'remote'}-${kind}`}
      data-pid={kind === 'cam' ? p.id : undefined}
      data-name={p.name}
      data-conn={p.conn}
      data-video={showVideo ? 'on' : 'off'}
      data-audio={p.audio ? 'on' : 'off'}
      data-leaving={p.leaving ? (ghosting ? 'ghost' : 'yes') : undefined}
      onDoubleClick={fullscreen}
    >
      {ghosting && <img className="ghost-room" src={p.roomPhoto!} alt="" />}

      {showVideo && !(ghosting && frozen) ? (
        <VideoView
          ref={video}
          stream={stream}
          mirror={p.isLocal && kind === 'cam' && mirrorSelf}
          fit={kind === 'screen' ? 'contain' : 'cover'}
        />
      ) : p.botImage ? (
        <img className="bot-img" src={p.botImage} alt={p.name} draggable={false} />
      ) : !ghosting ? (
        <div className="tile-avatar">
          <Avatar name={p.name} size={compact ? 48 : 84} src={p.pfp} />
        </div>
      ) : null}

      {ghosting && (
        <>
          <canvas ref={freeze} className={`ghost-freeze ${frozen ? 'fading' : ''}`} hidden={!showVideo} />
          {!showVideo && (
            <div className="tile-avatar ghost-freeze fading">
              <Avatar name={p.name} size={compact ? 48 : 84} src={p.pfp} />
            </div>
          )}
        </>
      )}

      {!p.isLocal && !p.leaving && p.conn !== 'connected' && (
        <div className={`tile-status status-${p.conn}`}>
          {p.conn === 'failed' ? <WifiOff size={16} /> : <Loader2 size={16} className="spin" />}
          <span>
            {p.conn === 'connecting' ? 'Connecting…' : p.conn === 'reconnecting' ? 'Reconnecting…' : "Can't connect (network blocks peer-to-peer)"}
          </span>
        </div>
      )}

      {showDetails && !p.isLocal && !p.leaving && p.conn === 'connected' && kind === 'cam' && (
        <div className="tile-details" data-testid="tile-stats" title={p.relay ? 'Relayed through a TURN server' : 'Direct peer-to-peer'}>
          <Radio size={12} /> {p.relay ? 'Relay' : 'Direct'}
          {st && st.width > 0 && ` · ${st.height}p${st.fps ? st.fps : ''}`}
          {st && st.kbps > 0 && ` · ${st.kbps >= 1000 ? `${(st.kbps / 1000).toFixed(1)} Mbps` : `${st.kbps} kbps`}`}
          {st?.delayMs != null ? ` · ~${st.delayMs} ms` : p.rtt != null ? ` · ${p.rtt} ms RTT` : ''}
          {st?.codec && ` · ${st.codec}`}
        </div>
      )}

      {!showDetails && !p.isLocal && !p.leaving && kind === 'cam' && p.quality != null && p.quality <= 2 && (
        <div className={`net-bars q${p.quality}`} title={['No connection', 'Poor connection', 'Fair connection', 'Good connection', 'Excellent connection'][p.quality]} data-testid="net-bars" data-quality={p.quality}>
          <i />
          <i />
          <i />
          <i />
        </div>
      )}

      {p.recording && kind === 'cam' && !p.leaving && <div className="tile-rec" title="Recording">REC</div>}

      {p.hand && kind === 'cam' && !p.leaving && (
        <div className="hand-badge" title="Hand raised" data-testid="hand-badge">
          <Hand size={16} />
        </div>
      )}

      <div className="tile-label">
        {kind === 'screen' && <MonitorUp size={14} />}
        {ghosting && <Ghost size={14} />}
        {kind === 'cam' && !p.audio && !p.leaving && <MicOff size={14} className="mic-off" aria-label="Muted" />}
        <span>{label}</span>
        {p.bot && <span className="bot-tag">BOT</span>}
        {p.isLocal && kind === 'cam' && p.roomPhoto && (
          <span className="ghost-mark" title="Ghost Protocol armed (only you can see this)">
            👻
          </span>
        )}
      </div>

      {throwing && onThrow && (
        <div className="tile-throw-picker" onMouseLeave={() => setThrowing(false)}>
          <ThrowPicker
            onPick={(item) => {
              onThrow(p.id, item);
              setThrowing(false);
            }}
          />
        </div>
      )}

      {!p.leaving && (
        <div className="tile-actions">
          {onThrow && kind === 'cam' && (
            <button onClick={() => setThrowing((v) => !v)} title={`Throw something at ${p.isLocal ? 'yourself' : p.name}`} aria-label="Throw something" data-testid="tile-throw">
              🍅
            </button>
          )}
          <button onClick={() => onPin(pinned ? null : tile.key)} title={pinned ? 'Unpin' : 'Pin'} aria-label={pinned ? 'Unpin' : 'Pin'}>
            {pinned ? <PinOff size={16} /> : <Pin size={16} />}
          </button>
          {showVideo && document.pictureInPictureEnabled && (
            <button onClick={() => void pip()} title="Picture-in-picture" aria-label="Picture-in-picture">
              <PictureInPicture2 size={16} />
            </button>
          )}
          <button onClick={fullscreen} title="Fullscreen" aria-label="Fullscreen">
            <Maximize2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
});
