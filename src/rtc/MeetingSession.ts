import { config, getIceServers } from '../config';
import { audioLevels } from '../lib/audioLevel';
import { randomId } from '../lib/crypto';
import { Emitter } from '../lib/emitter';
import { getClientId, getSettings, subscribeSettings } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { SignalingChannel } from '../signaling/SignalingChannel';
import type { FxKind, PeerInfo, SignalMessage, TransportStatus } from '../signaling/types';
import type { LocalMedia, TrackSlot } from './LocalMedia';
import { applyCodecPreference, applyLowLatency, senderBudget, tuneRemoteSdp } from './tuning';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface LinkStats {
  width: number;
  height: number;
  fps: number;
  kbps: number;
  /** Rough glass-to-glass estimate: half the round trip + receive buffer. */
  delayMs: number | null;
  codec: string;
  /** Packet loss over the last stats interval, percent. */
  loss: number;
}

export interface Participant {
  id: string;
  name: string;
  isLocal: boolean;
  audio: boolean;
  video: boolean;
  screen: boolean;
  hand: boolean;
  recording: boolean;
  captions: boolean;
  /** 1 (bad) to 4 (great), null = unknown. */
  quality: number | null;
  conn: ConnState;
  relay: boolean | null;
  rtt: number | null;
  stats: LinkStats | null;
  micStream: MediaStream | null;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  joinedAt: number;
  /** Set while a ghost-mode participant is fading out after leaving. */
  leaving: boolean;
  roomPhoto: string | null;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  isLocal: boolean;
  /** Local-only note (command output etc.), never sent. */
  system?: boolean;
}

export interface SessionSnapshot {
  left: boolean;
  signal: TransportStatus;
  signalDetail: string;
  transport: string;
  participants: Participant[];
  messages: ChatMessage[];
}

export type SessionEvent =
  | { type: 'react'; from: string; name: string; emoji: string; isLocal: boolean }
  | { type: 'fx'; from: string; name: string; fx: FxKind; isLocal: boolean }
  | { type: 'hand'; from: string; name: string; up: boolean; isLocal: boolean }
  | { type: 'typing'; from: string; name: string }
  | { type: 'app'; from: string; name: string; kind: string; data: unknown; isLocal: boolean }
  | { type: 'peer-ready'; from: string }
  | { type: 'recording'; from: string; name: string; on: boolean }
  | { type: 'captions'; wanted: boolean };

/**
 * Every peer connection has the same four transceivers in the same order, created
 * only by the "initiator" side (the peer with the smaller id). The other side adopts
 * them from the offer. That fixed layout lets us identify remote tracks by index and
 * swap local tracks with replaceTrack (mute, camera switch, effects, screen share)
 * without ever renegotiating, and since only one side offers there is never glare.
 * A negotiated data channel (id 0) rides along for peer-to-peer extras.
 */
const SLOTS: TrackSlot[] = ['mic', 'cam', 'screen', 'screenAudio'];
const KINDS = ['audio', 'video', 'video', 'audio'] as const;

const HEARTBEAT_MS = 8000;

/** 4 bars = great. Based on round-trip time and packet loss. */
function qualityScore(l: { conn: ConnState; rtt: number | null; stats: LinkStats | null }): number | null {
  if (l.conn !== 'connected') return l.conn === 'failed' ? 0 : null;
  if (l.rtt == null) return null;
  const loss = l.stats?.loss ?? 0;
  if (l.rtt < 150 && loss < 1.5) return 4;
  if (l.rtt < 300 && loss < 4) return 3;
  if (l.rtt < 500 && loss < 10) return 2;
  return 1;
}
const PEER_TIMEOUT_MS = 30000;
const GHOST_MS = 5200;

interface RemoteStreams {
  mic: MediaStream | null;
  cam: MediaStream | null;
  screen: MediaStream | null;
  screenAudio: MediaStream | null;
}

class PeerLink {
  pc: RTCPeerConnection | null = null;
  dc: RTCDataChannel | null = null;
  pcId = '';
  conn: ConnState = 'connecting';
  everConnected = false;
  relay: boolean | null = null;
  rtt: number | null = null;
  stats: LinkStats | null = null;
  prevInbound: { bytes: number; ts: number; jbDelay: number; jbCount: number; lost: number; recv: number } | null = null;
  media: RemoteStreams = { mic: null, cam: null, screen: null, screenAudio: null };
  lastSeen = Date.now();
  joinedAt = Date.now();
  pendingIce: { pcId: string; c: RTCIceCandidateInit }[] = [];
  outIce: RTCIceCandidateInit[] = [];
  outIceTimer: number | null = null;
  connectTimer: number | null = null;
  restartTimer: number | null = null;
  attempts = 0;
  lastRestartRequest = 0;
  roomPhoto: string | null = null;
  leaving = false;
  queue: Promise<void> = Promise.resolve();

  constructor(
    public id: string,
    public info: PeerInfo,
    public initiator: boolean,
  ) {}

  run(fn: () => Promise<void>) {
    this.queue = this.queue.then(fn).catch((err) => console.warn('[yapameet] peer op failed', err));
    return this.queue;
  }
}

export class MeetingSession extends Emitter {
  readonly selfId = randomId(8);
  readonly clientId = getClientId();
  private links = new Map<string, PeerLink>();
  private messages: ChatMessage[] = [];
  private seen = new Set<string>();
  private signal: SignalingChannel;
  private iceServers: RTCIceServer[] = [];
  private timers: number[] = [];
  private left = false;
  private joinedAt = 0;
  private signalUp = false;
  private lastInfoJson = '';
  private unsubLocal: (() => void) | null = null;
  private unsubSettings: (() => void) | null = null;
  private snapshot: SessionSnapshot;
  private eventListeners = new Set<(e: SessionEvent) => void>();
  private lastQuality = getSettings().videoQuality + getSettings().lowLatency;
  hand = false;
  recording = false;
  /** We want captions shown (everyone transcribes their own mic while anyone wants them). */
  captionsWanted = false;
  /** Ghost mode easter egg: a JPEG of our empty room, shared with peers. */
  roomPhoto: string | null = null;

  constructor(
    readonly code: string,
    readonly local: LocalMedia,
    private name: string,
  ) {
    super();
    this.signal = new SignalingChannel(code, this.selfId);
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot = () => this.snapshot;

  protected override emit() {
    this.snapshot = this.buildSnapshot();
    super.emit();
  }

  onEvent(fn: (e: SessionEvent) => void) {
    this.eventListeners.add(fn);
    return () => {
      this.eventListeners.delete(fn);
    };
  }

  private fire(e: SessionEvent) {
    for (const fn of this.eventListeners) fn(e);
  }

  // ---------------------------------------------------------------- lifecycle

  async join() {
    this.joinedAt = Date.now();
    this.local.onTrack = this.onLocalTrack;
    this.local.ensureMixer();
    this.unsubLocal = this.local.subscribe(this.onLocalChange);
    this.unsubSettings = subscribeSettings(this.onSettingsChange);
    (window as unknown as { __yapameet?: MeetingSession }).__yapameet = this;

    this.signal.onMessage = this.onSignal;
    this.signal.onStatus = this.onSignalStatus;

    this.iceServers = await getIceServers();
    if (this.left) return;

    this.timers.push(
      window.setInterval(() => void this.broadcastState(true), HEARTBEAT_MS),
      window.setInterval(this.sweep, 4000),
      window.setInterval(() => void this.collectStats(), 2000),
    );
    window.addEventListener('online', this.onOnline);
    window.addEventListener('pagehide', this.onPageHide);

    try {
      await this.signal.open();
    } catch (err) {
      console.error('[yapameet] signaling failed', err);
      this.onSignalStatus('error', (err as Error).message || 'Signaling failed');
    }
    this.emit();
  }

  async leave() {
    if (this.left) return;
    this.left = true;
    try {
      await Promise.race([this.signal.send({ t: 'bye' }), new Promise<void>((r) => setTimeout(r, 400))]);
    } catch {
      /* best effort */
    }
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    window.removeEventListener('online', this.onOnline);
    window.removeEventListener('pagehide', this.onPageHide);
    for (const link of [...this.links.values()]) this.dropLink(link, false);
    this.signal.close();
    this.unsubLocal?.();
    this.unsubSettings?.();
    this.unsubLocal = this.unsubSettings = null;
    if (this.local.onTrack === this.onLocalTrack) this.local.onTrack = null;
    const w = window as unknown as { __yapameet?: MeetingSession };
    if (w.__yapameet === this) delete w.__yapameet;
    this.emit();
  }

  private onPageHide = () => {
    void this.leave();
  };

  private onOnline = () => {
    for (const link of this.links.values()) if (link.conn !== 'connected') this.restart(link);
  };

  private onSettingsChange = () => {
    const s = getSettings();
    const key = s.videoQuality + s.lowLatency;
    if (key === this.lastQuality) return;
    this.lastQuality = key;
    for (const link of this.links.values()) {
      this.applyBitrates(link);
      link.pc?.getReceivers().forEach((r) => applyLowLatency(r, s.lowLatency));
    }
  };

  // ---------------------------------------------------------------- local side

  setName(name: string) {
    this.name = name.trim().slice(0, 40) || this.name;
    void this.broadcastState();
    this.emit();
  }

  setRecording(on: boolean) {
    if (this.recording === on) return;
    this.recording = on;
    void this.broadcastState();
    this.emit();
  }

  setCaptionsWanted(on: boolean) {
    if (this.captionsWanted === on) return;
    const before = this.anyoneWantsCaptions();
    this.captionsWanted = on;
    void this.broadcastState();
    if (before !== this.anyoneWantsCaptions()) this.fire({ type: 'captions', wanted: this.anyoneWantsCaptions() });
    this.emit();
  }

  /** True if anyone in the call (including us) has captions turned on. */
  anyoneWantsCaptions() {
    if (this.captionsWanted) return true;
    for (const l of this.links.values()) if (l.info.captions && !l.leaving) return true;
    return false;
  }

  /**
   * Feature data (whiteboard, polls, timer, captions). Goes peer-to-peer over the
   * data channel; falls back to encrypted signaling for peers whose channel isn't open.
   */
  sendApp(kind: string, data: unknown, to?: string) {
    if (this.left) return;
    const payload = JSON.stringify({ t: 'app', kind, data });
    for (const link of this.links.values()) {
      if (to && link.id !== to) continue;
      if (link.leaving) continue;
      if (link.dc?.readyState === 'open') {
        try {
          link.dc.send(payload);
          continue;
        } catch {
          /* fall through to signaling */
        }
      }
      void this.signal.send({ t: 'app', kind, data }, link.id);
    }
  }

  setHand(up: boolean) {
    if (this.hand === up) return;
    this.hand = up;
    this.fire({ type: 'hand', from: this.selfId, name: this.name, up, isLocal: true });
    void this.broadcastState();
    this.emit();
  }

  react(emoji: string) {
    if (this.left) return;
    const id = randomId(6);
    this.seen.add(id);
    this.fire({ type: 'react', from: this.selfId, name: this.name, emoji, isLocal: true });
    void this.signal.send({ t: 'react', id, emoji });
  }

  sendFx(fx: FxKind) {
    if (this.left) return;
    const id = randomId(6);
    this.seen.add(id);
    this.fire({ type: 'fx', from: this.selfId, name: this.name, fx, isLocal: true });
    void this.signal.send({ t: 'fx', id, fx });
  }

  /** Ghost mode: share a photo of our empty room so we can fade into it when leaving. */
  setRoomPhoto(dataUrl: string | null) {
    this.roomPhoto = dataUrl;
    for (const link of this.links.values()) this.sendRoomPhoto(link);
  }

  private sendRoomPhoto(link: PeerLink) {
    const dc = link.dc;
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(JSON.stringify({ t: 'room', data: this.roomPhoto }));
    } catch (err) {
      console.warn('[yapameet] room photo send failed', err);
    }
  }

  private localInfo(): PeerInfo {
    return {
      id: this.selfId,
      clientId: this.clientId,
      name: this.name,
      audio: this.local.micOn && !!this.local.mic,
      video: !!this.local.cam,
      screen: !!this.local.screen,
      hand: this.hand,
      recording: this.recording,
      captions: this.captionsWanted,
    };
  }

  private onLocalChange = () => {
    void this.broadcastState();
    this.emit();
  };

  private async broadcastState(force = false) {
    if (this.left) return;
    const info = this.localInfo();
    const json = JSON.stringify(info);
    if (!force && json === this.lastInfoJson) return;
    this.lastInfoJson = json;
    await this.signal.send({ t: 'state', peer: info });
  }

  private localTrack(i: number): MediaStreamTrack | null {
    return [this.local.micOut, this.local.cam, this.local.screen, this.local.audioOut][i];
  }

  private onLocalTrack = (slot: TrackSlot, track: MediaStreamTrack | null) => {
    const idx = SLOTS.indexOf(slot);
    for (const link of this.links.values()) {
      const tr = link.pc?.getTransceivers()[idx];
      if (tr && link.pc?.signalingState !== 'closed') {
        tr.sender
          .replaceTrack(track)
          .then(() => this.applyBitrates(link))
          .catch((err) => console.warn('[yapameet] replaceTrack', err));
      }
    }
  };

  sendChat(text: string) {
    const clean = text.trim().slice(0, 2000);
    if (!clean || this.left) return;
    const msg: ChatMessage = { id: randomId(8), from: this.selfId, name: this.name, text: clean, ts: Date.now(), isLocal: true };
    this.seen.add(msg.id);
    this.lastTypingSent = 0;
    this.pushMessage(msg);
    void this.signal.send({ t: 'chat', id: msg.id, name: this.name, text: clean, ts: msg.ts });
  }

  private lastTypingSent = 0;

  /** Tell others we're typing (throttled). */
  sendTyping() {
    const now = Date.now();
    if (this.left || now - this.lastTypingSent < 2500) return;
    this.lastTypingSent = now;
    void this.signal.send({ t: 'typing' });
  }

  /** A message only you see (chat command output). */
  addNote(text: string) {
    this.pushMessage({ id: randomId(8), from: 'system', name: 'Yapameet', text, ts: Date.now(), isLocal: true, system: true });
  }

  private pushMessage(m: ChatMessage) {
    this.messages = [...this.messages, m].slice(-500);
    this.emit();
  }

  // ---------------------------------------------------------------- signaling

  private onSignalStatus = (s: TransportStatus, detail = '') => {
    this.signal.status = s;
    this.signal.statusDetail = detail;
    const wasUp = this.signalUp;
    this.signalUp = s === 'connected';
    if (this.signalUp && !wasUp) {
      void this.signal.send({ t: 'hello', peer: this.localInfo() });
      for (const link of this.links.values()) if (link.conn !== 'connected') this.restart(link);
    }
    this.emit();
  };

  private onSignal = (from: string, msg: SignalMessage) => {
    if (this.left) return;
    switch (msg.t) {
      case 'hello':
      case 'state': {
        if (!msg.peer || msg.peer.id !== from) return;
        const existing = this.links.get(from);
        if (existing?.leaving) return;
        const isNew = !existing;
        const prevHand = existing?.info.hand ?? false;
        const prevRec = existing?.info.recording ?? false;
        const capsBefore = this.anyoneWantsCaptions();
        const link = this.upsertPeer(msg.peer);
        if (!link) return;
        if (!!msg.peer.hand !== prevHand && (!isNew || msg.peer.hand)) {
          this.fire({ type: 'hand', from, name: link.info.name, up: !!msg.peer.hand, isLocal: false });
        }
        if (!!msg.peer.recording !== prevRec) this.fire({ type: 'recording', from, name: link.info.name, on: !!msg.peer.recording });
        if (capsBefore !== this.anyoneWantsCaptions()) this.fire({ type: 'captions', wanted: this.anyoneWantsCaptions() });
        if ((msg.t === 'hello' && !msg.reply) || (msg.t === 'state' && isNew)) {
          void this.signal.send({ t: 'hello', peer: this.localInfo(), reply: true }, from);
        }
        if (msg.t === 'hello' && !isNew && link.conn !== 'connected') this.restart(link);
        break;
      }
      case 'bye': {
        const link = this.links.get(from);
        if (!link || link.leaving) return;
        if (msg.will && link.conn === 'connected') return;
        if (link.roomPhoto && !getSettings().reduceMotion) this.ghostOut(link);
        else this.dropLink(link, true);
        break;
      }
      case 'offer': {
        const link = this.links.get(from) ?? this.upsertPeer(this.placeholderInfo(from));
        if (link && !link.leaving) link.run(() => this.handleOffer(link, msg.pcId, msg.sdp));
        break;
      }
      case 'answer': {
        const link = this.links.get(from);
        if (link) link.run(() => this.handleAnswer(link, msg.pcId, msg.sdp));
        break;
      }
      case 'ice': {
        const link = this.links.get(from);
        if (link) link.run(() => this.handleIce(link, msg.pcId, msg.candidates));
        break;
      }
      case 'restart': {
        const link = this.links.get(from);
        if (!link || !link.initiator || link.leaving) return;
        link.lastSeen = Date.now();
        const now = Date.now();
        if (now - link.lastRestartRequest < 2500) return;
        link.lastRestartRequest = now;
        if (msg.pcId !== link.pcId || link.pc?.signalingState === 'closed') link.run(() => this.startPc(link));
        else this.restart(link);
        break;
      }
      case 'chat': {
        if (this.seen.has(msg.id) || typeof msg.text !== 'string') return;
        this.seen.add(msg.id);
        const link = this.links.get(from);
        if (link) link.lastSeen = Date.now();
        this.pushMessage({
          id: msg.id,
          from,
          name: link?.info.name || msg.name || 'Guest',
          text: msg.text.slice(0, 2000),
          ts: msg.ts || Date.now(),
          isLocal: false,
        });
        sounds.message();
        break;
      }
      case 'react': {
        if (this.seen.has(msg.id) || typeof msg.emoji !== 'string') return;
        this.seen.add(msg.id);
        const name = this.links.get(from)?.info.name || 'Someone';
        this.fire({ type: 'react', from, name, emoji: [...msg.emoji].slice(0, 2).join(''), isLocal: false });
        break;
      }
      case 'app': {
        const name = this.links.get(from)?.info.name || 'Someone';
        if (typeof msg.kind === 'string') this.fire({ type: 'app', from, name, kind: msg.kind, data: msg.data, isLocal: false });
        break;
      }
      case 'typing': {
        const name = this.links.get(from)?.info.name;
        if (name) this.fire({ type: 'typing', from, name });
        break;
      }
      case 'fx': {
        if (this.seen.has(msg.id)) return;
        this.seen.add(msg.id);
        if (!['confetti', 'party', 'barrelroll'].includes(msg.fx)) return;
        const name = this.links.get(from)?.info.name || 'Someone';
        this.fire({ type: 'fx', from, name, fx: msg.fx, isLocal: false });
        break;
      }
    }
    if (this.seen.size > 5000) this.seen = new Set([...this.seen].slice(-2000));
  };

  private placeholderInfo(id: string): PeerInfo {
    return { id, clientId: `unknown-${id}`, name: 'Guest', audio: false, video: false, screen: false };
  }

  private upsertPeer(info: PeerInfo): PeerLink | null {
    const clean: PeerInfo = {
      id: info.id,
      clientId: String(info.clientId || `unknown-${info.id}`),
      name: String(info.name || 'Guest').slice(0, 40),
      audio: !!info.audio,
      video: !!info.video,
      screen: !!info.screen,
      hand: !!info.hand,
      recording: !!info.recording,
      captions: !!info.captions,
    };
    const existing = this.links.get(clean.id);
    if (existing) {
      existing.info = clean;
      existing.lastSeen = Date.now();
      this.emit();
      return existing;
    }
    for (const other of [...this.links.values()]) {
      if (other.info.clientId === clean.clientId) this.dropLink(other, false);
    }
    const link = new PeerLink(clean.id, clean, this.selfId < clean.id);
    this.links.set(clean.id, link);
    if (Date.now() - this.joinedAt > 2500) sounds.join();
    if (link.initiator) link.run(() => this.startPc(link));
    else this.armConnectTimer(link, 6000);
    for (const l of this.links.values()) this.applyBitrates(l);
    this.emit();
    return link;
  }

  /** Ghost mode: keep the tile around while it fades into the empty-room photo. */
  private ghostOut(link: PeerLink) {
    link.leaving = true;
    if (link.connectTimer) clearTimeout(link.connectTimer);
    link.connectTimer = null;
    sounds.ghost();
    this.emit();
    window.setTimeout(() => this.dropLink(link, false), GHOST_MS);
  }

  private dropLink(link: PeerLink, withSound: boolean) {
    if (this.links.get(link.id) !== link) return;
    this.links.delete(link.id);
    this.closePc(link);
    if (link.connectTimer) clearTimeout(link.connectTimer);
    audioLevels.unwatch(link.id);
    if (withSound && !this.left) sounds.leave();
    for (const l of this.links.values()) this.applyBitrates(l);
    this.emit();
  }

  private sweep = () => {
    const now = Date.now();
    for (const link of [...this.links.values()]) {
      if (link.leaving) continue;
      if (now - link.lastSeen > PEER_TIMEOUT_MS && link.conn !== 'connected') {
        this.dropLink(link, true);
        continue;
      }
      if (link.pc && link.pc.signalingState === 'closed') {
        this.closePc(link);
        link.conn = 'reconnecting';
        this.emit();
        this.restart(link);
      }
    }
  };

  // ---------------------------------------------------------------- WebRTC

  private closePc(link: PeerLink) {
    if (link.outIceTimer) clearTimeout(link.outIceTimer);
    if (link.restartTimer) clearTimeout(link.restartTimer);
    link.outIceTimer = link.restartTimer = null;
    link.outIce = [];
    link.prevInbound = null;
    const pc = link.pc;
    link.pc = null;
    if (link.dc) {
      link.dc.onopen = link.dc.onmessage = null;
      link.dc = null;
    }
    if (pc) {
      pc.onicecandidate = pc.ontrack = pc.onconnectionstatechange = null;
      try {
        pc.close();
      } catch {
        /* already closed */
      }
    }
    link.media = { mic: null, cam: null, screen: null, screenAudio: null };
  }

  private createPc(link: PeerLink, pcId: string): RTCPeerConnection {
    this.closePc(link);
    const pc = new RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: config.forceRelay ? 'relay' : 'all',
      bundlePolicy: 'max-bundle',
    });
    link.pc = pc;
    link.pcId = pcId;
    link.relay = null;
    link.rtt = null;
    link.stats = null;
    link.conn = link.everConnected ? 'reconnecting' : 'connecting';

    // Negotiated on both sides with the same id, so it needs no extra signaling.
    const dc = pc.createDataChannel('yapa', { negotiated: true, id: 0 });
    link.dc = dc;
    dc.onopen = () => {
      if (this.roomPhoto) this.sendRoomPhoto(link);
      this.fire({ type: 'peer-ready', from: link.id });
    };
    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m?.t === 'app' && typeof m.kind === 'string') {
          this.fire({ type: 'app', from: link.id, name: link.info.name, kind: m.kind, data: m.data, isLocal: false });
        } else if (m?.t === 'room') {
          link.roomPhoto = typeof m.data === 'string' && m.data.startsWith('data:image/') ? m.data : null;
          this.emit();
        }
      } catch {
        /* ignore junk */
      }
    };

    pc.onicecandidate = (e) => {
      if (pc !== link.pc || !e.candidate) return;
      link.outIce.push(e.candidate.toJSON());
      if (!link.outIceTimer) {
        link.outIceTimer = window.setTimeout(() => {
          link.outIceTimer = null;
          const batch = link.outIce;
          link.outIce = [];
          if (batch.length && pc === link.pc) void this.signal.send({ t: 'ice', pcId, candidates: batch }, link.id);
        }, 60);
      }
    };

    pc.ontrack = (e) => {
      if (pc !== link.pc) return;
      applyLowLatency(e.receiver, getSettings().lowLatency);
      const idx = pc.getTransceivers().indexOf(e.transceiver);
      const slot = SLOTS[idx];
      if (!slot) return;
      link.media = { ...link.media, [slot]: new MediaStream([e.track]) };
      if (slot === 'mic') audioLevels.watch(link.id, link.media.mic);
      this.emit();
    };

    pc.onconnectionstatechange = () => this.onConnState(link, pc);
    this.armConnectTimer(link, 15000);
    this.emit();
    return pc;
  }

  private setCodecs(pc: RTCPeerConnection) {
    const pref = getSettings().codec;
    const trs = pc.getTransceivers();
    if (trs[1]) applyCodecPreference(trs[1], pref);
    if (trs[2]) applyCodecPreference(trs[2], pref);
  }

  private async startPc(link: PeerLink) {
    if (!this.links.has(link.id) || this.left || link.leaving) return;
    const pc = this.createPc(link, randomId(6));
    KINDS.forEach((kind, i) => pc.addTransceiver(this.localTrack(i) ?? kind, { direction: 'sendrecv' }));
    this.setCodecs(pc);
    await this.sendOffer(link, false);
  }

  private async sendOffer(link: PeerLink, iceRestart: boolean) {
    const pc = link.pc;
    if (!pc || pc.signalingState !== 'stable') return;
    const offer = await pc.createOffer({ iceRestart });
    if (pc !== link.pc) return;
    await pc.setLocalDescription(offer);
    if (pc !== link.pc || !pc.localDescription) return;
    await this.signal.send({ t: 'offer', pcId: link.pcId, sdp: pc.localDescription.sdp }, link.id);
  }

  private async handleOffer(link: PeerLink, pcId: string, sdp: string) {
    if (link.initiator || !this.links.has(link.id) || this.left) return;
    link.lastSeen = Date.now();
    if (link.pc?.signalingState === 'closed' && link.pcId === pcId) {
      this.closePc(link);
      link.lastRestartRequest = Date.now();
      await this.signal.send({ t: 'restart', pcId: '' }, link.id);
      return;
    }
    if (!link.pc || link.pcId !== pcId) this.createPc(link, pcId);
    const pc = link.pc!;
    if (pc.signalingState !== 'stable') {
      await pc.setLocalDescription({ type: 'rollback' }).catch(() => {});
    }
    await pc.setRemoteDescription({ type: 'offer', sdp: tuneRemoteSdp(sdp) });
    if (pc !== link.pc) return;
    const trs = pc.getTransceivers();
    for (let i = 0; i < SLOTS.length && i < trs.length; i++) {
      trs[i].direction = 'sendrecv';
      await trs[i].sender.replaceTrack(this.localTrack(i));
    }
    this.setCodecs(pc);
    const answer = await pc.createAnswer();
    if (pc !== link.pc) return;
    await pc.setLocalDescription(answer);
    if (!pc.localDescription) return;
    await this.signal.send({ t: 'answer', pcId, sdp: pc.localDescription.sdp }, link.id);
    await this.flushIce(link);
  }

  private async handleAnswer(link: PeerLink, pcId: string, sdp: string) {
    const pc = link.pc;
    if (!pc || link.pcId !== pcId || pc.signalingState !== 'have-local-offer') return;
    link.lastSeen = Date.now();
    await pc.setRemoteDescription({ type: 'answer', sdp: tuneRemoteSdp(sdp) });
    await this.flushIce(link);
  }

  private async handleIce(link: PeerLink, pcId: string, candidates: RTCIceCandidateInit[]) {
    if (!Array.isArray(candidates)) return;
    const pc = link.pc;
    if (pc && link.pcId === pcId && pc.remoteDescription) {
      for (const c of candidates) await pc.addIceCandidate(c).catch(() => {});
    } else {
      link.pendingIce.push(...candidates.map((c) => ({ pcId, c })));
      if (link.pendingIce.length > 300) link.pendingIce.splice(0, link.pendingIce.length - 300);
    }
  }

  private async flushIce(link: PeerLink) {
    const pc = link.pc;
    if (!pc?.remoteDescription) return;
    const ready = link.pendingIce.filter((p) => p.pcId === link.pcId);
    link.pendingIce = link.pendingIce.filter((p) => p.pcId !== link.pcId);
    for (const p of ready) await pc.addIceCandidate(p.c).catch(() => {});
  }

  private onConnState(link: PeerLink, pc: RTCPeerConnection) {
    if (pc !== link.pc) return;
    const s = pc.connectionState;
    if (s === 'connected') {
      link.conn = 'connected';
      link.everConnected = true;
      link.attempts = 0;
      link.lastSeen = Date.now();
      if (link.connectTimer) clearTimeout(link.connectTimer);
      if (link.restartTimer) clearTimeout(link.restartTimer);
      link.connectTimer = link.restartTimer = null;
      this.applyBitrates(link);
      void this.collectStats();
    } else if (s === 'disconnected') {
      link.conn = 'reconnecting';
      if (!link.restartTimer) {
        link.restartTimer = window.setTimeout(() => {
          link.restartTimer = null;
          if (link.pc === pc && pc.connectionState !== 'connected') this.restart(link);
        }, 3500);
      }
    } else if (s === 'failed') {
      link.conn = link.everConnected ? 'reconnecting' : 'failed';
      this.restart(link);
    }
    this.emit();
  }

  private armConnectTimer(link: PeerLink, ms: number) {
    if (link.connectTimer) clearTimeout(link.connectTimer);
    link.connectTimer = window.setTimeout(() => {
      link.connectTimer = null;
      if (!this.links.has(link.id) || this.left || link.leaving) return;
      if (link.pc?.connectionState === 'connected') return;
      if (link.attempts >= 1 && !link.everConnected) link.conn = 'failed';
      this.emit();
      this.restart(link);
      this.armConnectTimer(link, Math.min(30000, 12000 + link.attempts * 6000));
    }, ms);
  }

  private restart(link: PeerLink) {
    if (!this.links.has(link.id) || this.left || !this.signalUp || link.leaving) return;
    if (!link.initiator) {
      const now = Date.now();
      if (now - link.lastRestartRequest < 3000) return;
      link.lastRestartRequest = now;
      void this.signal.send({ t: 'restart', pcId: link.pc ? link.pcId : '' }, link.id);
      return;
    }
    link.attempts++;
    link.run(async () => {
      const pc = link.pc;
      if (!pc || link.attempts > 2 || pc.signalingState !== 'stable') await this.startPc(link);
      else {
        pc.restartIce();
        await this.sendOffer(link, true);
      }
    });
  }

  /** Quality preset + mesh-aware caps. Audio gets network priority over video. */
  private applyBitrates(link: PeerLink) {
    const pc = link.pc;
    if (!pc || pc.connectionState !== 'connected') return;
    const budget = senderBudget(this.links.size);
    const trs = pc.getTransceivers();
    const set = async (tr: RTCRtpTransceiver | undefined, fn: (p: RTCRtpSendParameters) => void) => {
      if (!tr) return;
      try {
        const p = tr.sender.getParameters();
        if (!p.encodings?.length) return;
        fn(p);
        await tr.sender.setParameters(p);
      } catch {
        /* not negotiated yet */
      }
    };
    void set(trs[0], (p) => {
      p.encodings[0].priority = 'high';
      p.encodings[0].networkPriority = 'high';
    });
    void set(trs[1], (p) => {
      const e = p.encodings[0];
      e.maxBitrate = budget.cam;
      e.maxFramerate = budget.fps;
      e.scaleResolutionDownBy = budget.scale;
      (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'balanced';
    });
    void set(trs[2], (p) => {
      p.encodings[0].maxBitrate = budget.screen;
      (p as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference = 'maintain-resolution';
    });
  }

  private async collectStats() {
    let changed = false;
    for (const link of this.links.values()) {
      const pc = link.pc;
      if (!pc || pc.connectionState !== 'connected') continue;
      try {
        const stats = await pc.getStats();
        let pair: RTCIceCandidatePairStats | undefined;
        stats.forEach((r) => {
          if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId);
        });
        if (!pair) {
          stats.forEach((r) => {
            if (r.type === 'candidate-pair' && r.state === 'succeeded' && r.nominated) pair = r;
          });
        }
        if (pair) {
          const lc = stats.get(pair.localCandidateId);
          const rc = stats.get(pair.remoteCandidateId);
          link.relay = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
          link.rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
        }
        // Incoming camera video (transceiver 1).
        const camMid = pc.getTransceivers()[1]?.mid;
        stats.forEach((r) => {
          if (r.type !== 'inbound-rtp' || r.kind !== 'video' || r.mid !== camMid) return;
          const now = r.timestamp as number;
          const prev = link.prevInbound;
          const jbDelay = (r.jitterBufferDelay as number) || 0;
          const jbCount = (r.jitterBufferEmittedCount as number) || 0;
          const lost = Math.max(0, (r.packetsLost as number) || 0);
          const recv = (r.packetsReceived as number) || 0;
          let loss = link.stats?.loss ?? 0;
          let kbps = link.stats?.kbps ?? 0;
          let buffer: number | null = null;
          if (prev && now > prev.ts) {
            kbps = Math.round((((r.bytesReceived as number) - prev.bytes) * 8) / (now - prev.ts));
            if (jbCount > prev.jbCount) buffer = ((jbDelay - prev.jbDelay) / (jbCount - prev.jbCount)) * 1000;
            const dl = lost - prev.lost;
            const dr = recv - prev.recv;
            if (dl + dr > 0) loss = Math.round((dl / (dl + dr)) * 1000) / 10;
          }
          link.prevInbound = { bytes: r.bytesReceived as number, ts: now, jbDelay, jbCount, lost, recv };
          const codec = r.codecId ? (stats.get(r.codecId)?.mimeType as string | undefined)?.replace('video/', '') ?? '' : '';
          link.stats = {
            width: (r.frameWidth as number) || 0,
            height: (r.frameHeight as number) || 0,
            fps: Math.round((r.framesPerSecond as number) || 0),
            kbps,
            delayMs: buffer != null && link.rtt != null ? Math.round(link.rtt / 2 + buffer + 15) : (link.stats?.delayMs ?? null),
            codec,
            loss,
          };
        });
        changed = true;
      } catch {
        /* pc closed mid-call */
      }
    }
    if (changed) this.emit();
  }

  // ---------------------------------------------------------------- snapshot

  private buildSnapshot(): SessionSnapshot {
    const me: Participant = {
      id: this.selfId,
      name: this.name,
      isLocal: true,
      audio: this.local.micOn && !!this.local.mic,
      video: !!this.local.cam,
      screen: !!this.local.screen,
      hand: this.hand,
      recording: this.recording,
      captions: this.captionsWanted,
      quality: null,
      conn: 'connected',
      relay: null,
      rtt: null,
      stats: null,
      micStream: this.local.micStream,
      camStream: this.local.camStream,
      screenStream: this.local.screenStream,
      screenAudioStream: null,
      joinedAt: this.joinedAt,
      leaving: false,
      roomPhoto: this.roomPhoto,
    };
    const others: Participant[] = [...this.links.values()]
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map((l) => ({
        id: l.id,
        name: l.info.name,
        isLocal: false,
        audio: l.info.audio,
        video: l.info.video,
        screen: l.info.screen,
        hand: !!l.info.hand,
        recording: !!l.info.recording,
        captions: !!l.info.captions,
        quality: qualityScore(l),
        conn: l.leaving ? 'connected' : l.conn,
        relay: l.relay,
        rtt: l.rtt,
        stats: l.stats,
        micStream: l.media.mic,
        camStream: l.media.cam,
        screenStream: l.leaving ? null : l.media.screen,
        screenAudioStream: l.media.screenAudio,
        joinedAt: l.joinedAt,
        leaving: l.leaving,
        roomPhoto: l.roomPhoto,
      }));
    return {
      left: this.left,
      signal: this.signal?.status ?? 'connecting',
      signalDetail: this.signal?.statusDetail ?? '',
      transport: this.signal?.transportName ?? '',
      participants: [me, ...others],
      messages: this.messages,
    };
  }
}
