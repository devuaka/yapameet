import { memo, useRef } from 'react';
import { Loader2, Maximize2, MicOff, MonitorUp, PictureInPicture2, Pin, PinOff, Radio, WifiOff } from 'lucide-react';
import type { Participant } from '../rtc/MeetingSession';
import { Avatar } from './controls';
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
}: {
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
  const speaking = useSpeaking(p.id) && p.audio && kind === 'cam';
  const stream = kind === 'cam' ? p.camStream : p.screenStream;
  const showVideo = !!stream && (kind === 'cam' ? p.video : p.screen);
  const label = kind === 'screen' ? `${p.isLocal ? 'You are' : `${p.name} is`} presenting` : p.isLocal ? `${p.name} (You)` : p.name;

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

  return (
    <div
      ref={box}
      className={`tile ${speaking ? 'speaking' : ''} ${kind === 'screen' ? 'tile-screen' : ''} ${compact ? 'compact' : ''}`}
      style={style}
      data-testid={`tile-${p.isLocal ? 'local' : 'remote'}-${kind}`}
      data-name={p.name}
      data-conn={p.conn}
      data-video={showVideo ? 'on' : 'off'}
      data-audio={p.audio ? 'on' : 'off'}
      onDoubleClick={fullscreen}
    >
      {showVideo ? (
        <VideoView
          ref={video}
          stream={stream}
          mirror={p.isLocal && kind === 'cam' && mirrorSelf}
          fit={kind === 'screen' ? 'contain' : 'cover'}
        />
      ) : (
        <div className="tile-avatar">
          <Avatar name={p.name} size={compact ? 48 : 84} />
        </div>
      )}

      {!p.isLocal && p.conn !== 'connected' && (
        <div className={`tile-status status-${p.conn}`}>
          {p.conn === 'failed' ? <WifiOff size={16} /> : <Loader2 size={16} className="spin" />}
          <span>
            {p.conn === 'connecting' ? 'Connecting…' : p.conn === 'reconnecting' ? 'Reconnecting…' : "Can't connect (network blocks peer-to-peer)"}
          </span>
        </div>
      )}

      {showDetails && !p.isLocal && p.conn === 'connected' && (
        <div className="tile-details" title={p.relay ? 'Relayed through a TURN server' : 'Direct peer-to-peer'}>
          <Radio size={12} /> {p.relay ? 'Relay' : 'Direct'}
          {p.rtt != null && ` · ${p.rtt} ms`}
        </div>
      )}

      <div className="tile-label">
        {kind === 'screen' && <MonitorUp size={14} />}
        {kind === 'cam' && !p.audio && <MicOff size={14} className="mic-off" aria-label="Muted" />}
        <span>{label}</span>
      </div>

      <div className="tile-actions">
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
    </div>
  );
});
