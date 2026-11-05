import { Copy, Hand, Mic, MicOff, MonitorUp, Video, VideoOff } from 'lucide-react';
import type { Participant } from '../rtc/MeetingSession';
import { Avatar } from './controls';
import { useSpeaking } from './media';

function Row({ p }: { p: Participant }) {
  const speaking = useSpeaking(p.id) && p.audio;
  const conn =
    p.isLocal
      ? null
      : p.conn === 'connected'
        ? `${p.relay ? 'Relayed' : 'Direct'}${p.rtt != null ? ` · ${p.rtt} ms` : ''}`
        : p.conn === 'failed'
          ? "Can't connect"
          : p.conn === 'reconnecting'
            ? 'Reconnecting…'
            : 'Connecting…';
  return (
    <li className={`person ${speaking ? 'speaking' : ''}`} data-testid="participant-row">
      <Avatar name={p.name} size={36} src={p.pfp} />
      <div className="person-info">
        <span className="person-name">
          {p.name}
          {p.isLocal && <span className="muted"> (You)</span>}
        </span>
        {conn && <span className={`person-conn conn-${p.conn}`}>{conn}</span>}
      </div>
      <div className="person-icons">
        {p.hand && <Hand size={16} className="accent" aria-label="Hand raised" />}
        {p.screen && <MonitorUp size={16} className="accent" aria-label="Presenting" />}
        {p.video ? <Video size={16} /> : <VideoOff size={16} className="muted" />}
        {p.audio ? <Mic size={16} className={speaking ? 'accent' : ''} /> : <MicOff size={16} className="danger" />}
      </div>
    </li>
  );
}

export function ParticipantsPanel({
  participants,
  onCopyLink,
}: {
  participants: Participant[];
  onCopyLink: () => void;
}) {
  return (
    <div className="side-content" aria-label="People">
      <button className="btn btn-ghost btn-block" onClick={onCopyLink}>
        <Copy size={16} /> Copy invite link
      </button>
      <ul className="people-list">
        {[...participants].sort((a, b) => Number(b.hand) - Number(a.hand)).map((p) => (
          <Row key={p.id} p={p} />
        ))}
      </ul>
      {participants.length > 6 && (
        <p className="side-note">
          Heads up: with {participants.length} people everyone uploads {participants.length - 1} video streams. Turn cameras off if
          calls get choppy.
        </p>
      )}
    </div>
  );
}
