export type TransportStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';

/** A dumb pub/sub pipe for opaque (already encrypted) strings within one room. */
export interface RawTransport {
  readonly name: string;
  connect(
    topic: string,
    handlers: { onMessage: (data: string) => void; onStatus: (s: TransportStatus, detail?: string) => void },
    willPayload?: string,
  ): Promise<void>;
  publish(data: string): void;
  close(): void;
}

export interface PeerInfo {
  id: string;
  clientId: string;
  name: string;
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand?: boolean;
  recording?: boolean;
  captions?: boolean;
}

export type FxKind = 'confetti' | 'party' | 'barrelroll';

export type SignalMessage =
  | { t: 'hello'; peer: PeerInfo; reply?: boolean }
  | { t: 'state'; peer: PeerInfo }
  /** will=true: sent by the MQTT broker after our connection died (may be stale). */
  | { t: 'bye'; will?: boolean }
  | { t: 'offer'; pcId: string; sdp: string }
  | { t: 'answer'; pcId: string; sdp: string }
  | { t: 'ice'; pcId: string; candidates: RTCIceCandidateInit[] }
  | { t: 'restart'; pcId: string }
  | { t: 'chat'; id: string; name: string; text: string; ts: number }
  | { t: 'react'; id: string; emoji: string }
  | { t: 'fx'; id: string; fx: FxKind }
  | { t: 'typing' }
  | { t: 'app'; kind: string; data: unknown };

export interface Envelope {
  v: 1;
  mid: string;
  from: string;
  to?: string;
  msg: SignalMessage;
}
