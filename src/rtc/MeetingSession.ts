import { config, getIceServers } from '../config';
import { audioLevels } from '../lib/audioLevel';
import { randomId } from '../lib/crypto';
import { Emitter } from '../lib/emitter';
import { getClientId } from '../lib/settings';
import { sounds } from '../lib/sounds';
import { SignalingChannel } from '../signaling/SignalingChannel';
import type { PeerInfo, SignalMessage, TransportStatus } from '../signaling/types';
import type { LocalMedia, TrackSlot } from './LocalMedia';

export type ConnState = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export interface Participant {
  id: string;
  name: string;
  isLocal: boolean;
  audio: boolean;
  video: boolean;
  screen: boolean;
  conn: ConnState;
  relay: boolean | null;
  rtt: number | null;
  micStream: MediaStream | null;
  camStream: MediaStream | null;
  screenStream: MediaStream | null;
  screenAudioStream: MediaStream | null;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  isLocal: boolean;
}

export interface SessionSnapshot {
  left: boolean;
  signal: TransportStatus;
  signalDetail: string;
  transport: string;
  participants: Participant[];
  messages: ChatMessage[];
}

/**
 * Every peer connection has the same four transceivers in the same order, created
 * only by the "initiator" side (the peer with the smaller id). The other side adopts
 * them from the offer. That fixed layout lets us identify remote tracks by index and
 * swap local tracks with replaceTrack (mute, camera switch, screen share) without
 * ever renegotiating, and since only one side offers there is never offer glare.
 */
const SLOTS: TrackSlot[] = ['mic', 'cam', 'screen', 'screenAudio'];
const KINDS = ['audio', 'video', 'video', 'audio'] as const;

const HEARTBEAT_MS = 8000;
const PEER_TIMEOUT_MS = 30000;

interface RemoteStreams {
  mic: MediaStream | null;
  cam: MediaStream | null;
  screen: MediaStream | null;
  screenAudio: MediaStream | null;
}

class PeerLink {
  pc: RTCPeerConnection | null = null;
  pcId = '';
  conn: ConnState = 'connecting';
  everConnected = false;
  relay: boolean | null = null;
  rtt: number | null = null;
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
  /** Serializes async SDP work so offers/answers/candidates never interleave. */
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
  private seenChat = new Set<string>();
  private signal: SignalingChannel;
  private iceServers: RTCIceServer[] = [];
  private timers: number[] = [];
  private left = false;
  private joinedAt = 0;
  private signalUp = false;
  private lastInfoJson = '';
  private unsubLocal: (() => void) | null = null;
  private snapshot: SessionSnapshot;

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

  // ---------------------------------------------------------------- lifecycle

  async join() {
    this.joinedAt = Date.now();
    this.local.onTrack = this.onLocalTrack;
    this.unsubLocal = this.local.subscribe(this.onLocalChange);
    (window as unknown as { __yapameet?: MeetingSession }).__yapameet = this;

    this.signal.onMessage = this.onSignal;
    this.signal.onStatus = this.onSignalStatus;

    this.iceServers = await getIceServers();
    if (this.left) return;

    this.timers.push(
      window.setInterval(() => void this.broadcastState(true), HEARTBEAT_MS),
      window.setInterval(this.sweep, 4000),
      window.setInterval(() => void this.collectStats(), 4000),
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

  /** Leave the meeting: say goodbye, close every connection, release timers. */
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
    this.unsubLocal = null;
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

  // ---------------------------------------------------------------- local side

  setName(name: string) {
    this.name = name.trim().slice(0, 40) || this.name;
    void this.broadcastState();
    this.emit();
  }

  private localInfo(): PeerInfo {
    return {
      id: this.selfId,
      clientId: this.clientId,
      name: this.name,
      audio: this.local.micOn && !!this.local.mic,
      video: !!this.local.cam,
      screen: !!this.local.screen,
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
    return [this.local.mic, this.local.cam, this.local.screen, this.local.screenAudio][i];
  }

  private onLocalTrack = (slot: TrackSlot, track: MediaStreamTrack | null) => {
    const idx = SLOTS.indexOf(slot);
    for (const link of this.links.values()) {
      const tr = link.pc?.getTransceivers()[idx];
      if (tr && link.pc?.signalingState !== 'closed') {
        tr.sender.replaceTrack(track).catch((err) => console.warn('[yapameet] replaceTrack', err));
      }
    }
    if (slot === 'screen') for (const link of this.links.values()) this.applyBitrates(link);
  };

  sendChat(text: string) {
    const clean = text.trim().slice(0, 2000);
    if (!clean || this.left) return;
    const msg: ChatMessage = { id: randomId(8), from: this.selfId, name: this.name, text: clean, ts: Date.now(), isLocal: true };
    this.seenChat.add(msg.id);
    this.pushMessage(msg);
    void this.signal.send({ t: 'chat', id: msg.id, name: this.name, text: clean, ts: msg.ts });
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
      // (Re)announce ourselves. Existing peers reply so we learn about them.
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
        const isNew = !this.links.has(from);
        const link = this.upsertPeer(msg.peer);
        if (!link) return;
        if ((msg.t === 'hello' && !msg.reply) || (msg.t === 'state' && isNew)) {
          void this.signal.send({ t: 'hello', peer: this.localInfo(), reply: true }, from);
        }
        if (msg.t === 'hello' && !isNew && link.conn !== 'connected') this.restart(link);
        break;
      }
      case 'bye': {
        const link = this.links.get(from);
        if (!link) return;
        // A broker "last will" can arrive after the peer already reconnected; trust live media over it.
        if (msg.will && link.conn === 'connected') return;
        this.dropLink(link, true);
        break;
      }
      case 'offer': {
        const link = this.links.get(from) ?? this.upsertPeer(this.placeholderInfo(from));
        if (link) link.run(() => this.handleOffer(link, msg.pcId, msg.sdp));
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
        if (!link || !link.initiator) return;
        link.lastSeen = Date.now();
        // The peer only asks when its side is broken, even if ours still looks fine.
        const now = Date.now();
        if (now - link.lastRestartRequest < 2500) return;
        link.lastRestartRequest = now;
        if (msg.pcId !== link.pcId || link.pc?.signalingState === 'closed') link.run(() => this.startPc(link));
        else this.restart(link);
        break;
      }
      case 'chat': {
        if (this.seenChat.has(msg.id) || typeof msg.text !== 'string') return;
        this.seenChat.add(msg.id);
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
    }
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
    };
    const existing = this.links.get(clean.id);
    if (existing) {
      existing.info = clean;
      existing.lastSeen = Date.now();
      this.emit();
      return existing;
    }
    // Same browser tab came back with a new id (reload / rejoin): replace, don't duplicate.
    for (const other of [...this.links.values()]) {
      if (other.info.clientId === clean.clientId) this.dropLink(other, false);
    }
    const link = new PeerLink(clean.id, clean, this.selfId < clean.id);
    this.links.set(clean.id, link);
    // No join chime for people who were already here when we arrived.
    if (Date.now() - this.joinedAt > 2500) sounds.join();
    if (link.initiator) link.run(() => this.startPc(link));
    else this.armConnectTimer(link, 6000); // ask the initiator to (re)offer if nothing arrives
    for (const l of this.links.values()) this.applyBitrates(l);
    this.emit();
    return link;
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

  /** Forget peers that stopped heartbeating and have no live media connection. */
  private sweep = () => {
    const now = Date.now();
    for (const link of [...this.links.values()]) {
      if (now - link.lastSeen > PEER_TIMEOUT_MS && link.conn !== 'connected') {
        this.dropLink(link, true);
        continue;
      }
      // A connection that died without events (closed under us): rebuild it.
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
    const pc = link.pc;
    link.pc = null;
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
    link.conn = link.everConnected ? 'reconnecting' : 'connecting';

    pc.onicecandidate = (e) => {
      if (pc !== link.pc || !e.candidate) return;
      link.outIce.push(e.candidate.toJSON());
      // Batch candidates: fewer relay messages (matters for Supabase rate limits).
      if (!link.outIceTimer) {
        link.outIceTimer = window.setTimeout(() => {
          link.outIceTimer = null;
          const batch = link.outIce;
          link.outIce = [];
          if (batch.length && pc === link.pc) void this.signal.send({ t: 'ice', pcId, candidates: batch }, link.id);
        }, 80);
      }
    };

    pc.ontrack = (e) => {
      if (pc !== link.pc) return;
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

  /** Initiator: brand-new connection with the fixed transceiver layout. */
  private async startPc(link: PeerLink) {
    if (!this.links.has(link.id) || this.left) return;
    const pc = this.createPc(link, randomId(6));
    KINDS.forEach((kind, i) => pc.addTransceiver(this.localTrack(i) ?? kind, { direction: 'sendrecv' }));
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

  /** Non-initiator: adopt the offer's transceivers and attach our tracks. */
  private async handleOffer(link: PeerLink, pcId: string, sdp: string) {
    if (link.initiator || !this.links.has(link.id) || this.left) return;
    link.lastSeen = Date.now();
    if (link.pc?.signalingState === 'closed' && link.pcId === pcId) {
      // Our end of this connection is gone; a renegotiation can't revive it. Ask for a fresh one.
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
    await pc.setRemoteDescription({ type: 'offer', sdp });
    if (pc !== link.pc) return;
    const trs = pc.getTransceivers();
    for (let i = 0; i < SLOTS.length && i < trs.length; i++) {
      trs[i].direction = 'sendrecv';
      await trs[i].sender.replaceTrack(this.localTrack(i));
    }
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
    await pc.setRemoteDescription({ type: 'answer', sdp });
    await this.flushIce(link);
  }

  private async handleIce(link: PeerLink, pcId: string, candidates: RTCIceCandidateInit[]) {
    if (!Array.isArray(candidates)) return;
    const pc = link.pc;
    if (pc && link.pcId === pcId && pc.remoteDescription) {
      for (const c of candidates) await pc.addIceCandidate(c).catch(() => {});
    } else {
      // Candidates can beat the offer when they travel via a different broker.
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
      // Often recovers by itself within a few seconds (Wi-Fi blip). Restart ICE if not.
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
      if (!this.links.has(link.id) || this.left) return;
      if (link.pc?.connectionState === 'connected') return;
      if (link.attempts >= 1 && !link.everConnected) link.conn = 'failed';
      this.emit();
      this.restart(link);
      this.armConnectTimer(link, Math.min(30000, 12000 + link.attempts * 6000));
    }, ms);
  }

  /** ICE restart, escalating to a brand-new connection if restarts don't help. */
  private restart(link: PeerLink) {
    if (!this.links.has(link.id) || this.left || !this.signalUp) return;
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

  /** Mesh = every sender uploads to every peer, so cap bitrate as the room grows. */
  private applyBitrates(link: PeerLink) {
    const pc = link.pc;
    if (!pc || pc.connectionState !== 'connected') return;
    const n = this.links.size;
    const cam = n <= 1 ? 1_800_000 : n <= 3 ? 900_000 : n <= 5 ? 500_000 : 280_000;
    const screen = n <= 1 ? 2_500_000 : n <= 3 ? 1_500_000 : 800_000;
    const trs = pc.getTransceivers();
    const set = async (tr: RTCRtpTransceiver | undefined, maxBitrate: number, scale?: number) => {
      if (!tr) return;
      try {
        const p = tr.sender.getParameters();
        if (!p.encodings?.length) return;
        p.encodings[0].maxBitrate = maxBitrate;
        if (scale) p.encodings[0].scaleResolutionDownBy = scale;
        await tr.sender.setParameters(p);
      } catch {
        /* not negotiated yet */
      }
    };
    void set(trs[1], cam, n > 5 ? 2 : 1);
    void set(trs[2], screen);
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
        if (!pair) continue;
        const lc = stats.get(pair.localCandidateId);
        const rc = stats.get(pair.remoteCandidateId);
        const relay = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
        const rtt = pair.currentRoundTripTime != null ? Math.round(pair.currentRoundTripTime * 1000) : null;
        if (relay !== link.relay || rtt !== link.rtt) {
          link.relay = relay;
          link.rtt = rtt;
          changed = true;
        }
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
      conn: 'connected',
      relay: null,
      rtt: null,
      micStream: this.local.micStream,
      camStream: this.local.camStream,
      screenStream: this.local.screenStream,
      screenAudioStream: null,
      joinedAt: this.joinedAt,
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
        conn: l.conn,
        relay: l.relay,
        rtt: l.rtt,
        micStream: l.media.mic,
        camStream: l.media.cam,
        screenStream: l.media.screen,
        screenAudioStream: l.media.screenAudio,
        joinedAt: l.joinedAt,
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
