import { Emitter } from '../lib/emitter';
import { QUALITY, getSettings, subscribeSettings, updateSettings } from '../lib/settings';
import { EffectsPipeline, effectsNeeded, segmenterError, type EffectOptions } from './effects';
import { getAudioContext } from '../lib/sounds';

export type MediaErrorKind = 'denied' | 'notfound' | 'inuse' | 'unsupported' | 'unknown';
export interface MediaErrorInfo {
  kind: MediaErrorKind;
  message: string;
}

export type TrackSlot = 'mic' | 'cam' | 'screen' | 'screenAudio';

function describeError(err: unknown, what: 'microphone' | 'camera' | 'screen'): MediaErrorInfo {
  const name = (err as DOMException)?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return what === 'screen'
      ? { kind: 'denied', message: 'Screen sharing was cancelled or blocked.' }
      : {
          kind: 'denied',
          message: `${what === 'camera' ? 'Camera' : 'Microphone'} access is blocked. Click the lock/camera icon in the address bar, allow it, then try again.`,
        };
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return { kind: 'notfound', message: `No ${what} found. Plug one in and try again.` };
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return {
      kind: 'inuse',
      message: `Your ${what} is being used by another app (or failed to start). Close other apps using it and retry.`,
    };
  }
  if (!navigator.mediaDevices || name === 'TypeError') {
    return {
      kind: 'unsupported',
      message: 'This browser blocks media here. Use Chrome or Edge over https:// (or localhost).',
    };
  }
  return { kind: 'unknown', message: `Couldn't start ${what}: ${(err as Error)?.message || name || 'unknown error'}` };
}

const effectOptions = (): EffectOptions => {
  const s = getSettings();
  return { bg: s.bgEffect, bgImage: s.bgImage, filter: s.filter, lowLight: s.lowLightBoost };
};

/**
 * Owns this user's tracks: mic, camera (raw + effects output), screen (+ audio),
 * device lists and device errors. MeetingSession listens to `onTrack` and swaps
 * tracks into every peer connection with replaceTrack, so nothing renegotiates.
 */
export class LocalMedia extends Emitter {
  mic: MediaStreamTrack | null = null;
  /** The camera track that is shown and sent (effects output, or the raw camera). */
  cam: MediaStreamTrack | null = null;
  /** The camera exactly as captured. */
  rawCam: MediaStreamTrack | null = null;
  screen: MediaStreamTrack | null = null;
  screenAudio: MediaStreamTrack | null = null;
  pipeline: EffectsPipeline | null = null;

  micOn = true;
  camOn = true;

  micError: MediaErrorInfo | null = null;
  camError: MediaErrorInfo | null = null;
  screenError: MediaErrorInfo | null = null;

  devices: MediaDeviceInfo[] = [];
  micStarting = false;
  camStarting = false;

  camStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;
  micStream: MediaStream | null = null;
  /** Always-enabled clone of the mic, so we can notice talking while muted. */
  micMonitorStream: MediaStream | null = null;

  onTrack: ((slot: TrackSlot, track: MediaStreamTrack | null) => void) | null = null;

  /** Soundboard ids currently playing. */
  playingSounds = new Set<string>();
  private mixDest: MediaStreamAudioDestinationNode | null = null;
  private boardGain: GainNode | null = null;
  private monitorGain: GainNode | null = null;
  private screenSrc: MediaStreamAudioSourceNode | null = null;
  private sources = new Map<AudioBufferSourceNode, string>();

  private micSeq = 0;
  private camSeq = 0;
  private disposed = false;
  private unsubSettings: (() => void) | null = null;
  private lastEffects = JSON.stringify(effectOptions());
  private lastQuality = getSettings().videoQuality;

  constructor() {
    super();
    const s = getSettings();
    this.micOn = !s.joinMuted;
    this.camOn = !s.joinCameraOff;
  }

  get supported() {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  get canShareScreen() {
    return !!navigator.mediaDevices?.getDisplayMedia;
  }

  get micId() {
    return this.mic?.getSettings().deviceId || getSettings().micId;
  }

  get camId() {
    return this.rawCam?.getSettings().deviceId || getSettings().camId;
  }

  get effectsError() {
    return getSettings().bgEffect !== 'none' && this.pipeline && !this.pipeline.segmenterReady ? segmenterError : '';
  }

  refreshDevices = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      this.devices = await navigator.mediaDevices.enumerateDevices();
      this.emit();
    } catch {
      /* ignore */
    }
  };

  private onSettings = () => {
    const fx = JSON.stringify(effectOptions());
    if (fx !== this.lastEffects) {
      this.lastEffects = fx;
      this.rebuildCamOutput();
    }
    const q = getSettings().videoQuality;
    if (q !== this.lastQuality) {
      this.lastQuality = q;
      if (this.rawCam) void this.startCam(this.camId);
    }
  };

  async start() {
    this.disposed = false;
    if (!this.unsubSettings) this.unsubSettings = subscribeSettings(this.onSettings);
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.refreshDevices);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.refreshDevices);
    if (!this.supported) {
      const info = describeError(new TypeError('no mediaDevices'), 'camera');
      this.micError = info;
      this.camError = info;
      this.emit();
      return;
    }
    await Promise.all([
      this.mic ? null : this.startMic(getSettings().micId),
      this.camOn && !this.rawCam ? this.startCam(getSettings().camId) : null,
    ]);
    await this.refreshDevices();
  }

  async retry() {
    if (this.camError) this.camOn = true;
    if (this.micError) this.micOn = true;
    await this.start();
  }

  private audioConstraints(deviceId?: string): MediaTrackConstraints {
    const s = getSettings();
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: s.echoCancellation,
      noiseSuppression: s.noiseSuppression,
      autoGainControl: s.autoGainControl,
      channelCount: 1,
      sampleRate: 48000,
    };
  }

  private videoConstraints(deviceId?: string): MediaTrackConstraints {
    const q = QUALITY[getSettings().videoQuality];
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: q.width },
      height: { ideal: q.height },
      frameRate: { ideal: q.fps, max: q.fps },
      aspectRatio: { ideal: 16 / 9 },
    };
  }

  private async getTrack(kind: 'audio' | 'video', deviceId?: string): Promise<MediaStreamTrack> {
    const build = (id?: string) =>
      kind === 'audio' ? { audio: this.audioConstraints(id) } : { video: this.videoConstraints(id) };
    try {
      const stream = await navigator.mediaDevices.getUserMedia(build(deviceId));
      return kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
    } catch (err) {
      const name = (err as DOMException)?.name;
      if (deviceId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
        const stream = await navigator.mediaDevices.getUserMedia(build(undefined));
        return kind === 'audio' ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
      }
      throw err;
    }
  }

  async startMic(deviceId?: string) {
    const seq = ++this.micSeq;
    this.micStarting = true;
    this.emit();
    try {
      const track = await this.getTrack('audio', deviceId);
      if (seq !== this.micSeq || this.disposed) {
        track.stop();
        return;
      }
      this.setMic(track);
      this.micError = null;
      if (deviceId !== undefined) {
        const id = track.getSettings().deviceId;
        if (id) updateSettings({ micId: id });
      }
    } catch (err) {
      if (seq === this.micSeq) this.micError = describeError(err, 'microphone');
    } finally {
      if (seq === this.micSeq) this.micStarting = false;
      this.emit();
    }
  }

  async startCam(deviceId?: string) {
    const seq = ++this.camSeq;
    this.camStarting = true;
    this.emit();
    try {
      const track = await this.getTrack('video', deviceId);
      if (seq !== this.camSeq || this.disposed || !this.camOn) {
        track.stop();
        return;
      }
      this.setCam(track);
      this.camError = null;
      const id = track.getSettings().deviceId;
      if (id) updateSettings({ camId: id });
    } catch (err) {
      if (seq === this.camSeq) {
        this.camError = describeError(err, 'camera');
        this.camOn = false;
      }
    } finally {
      if (seq === this.camSeq) this.camStarting = false;
      this.emit();
    }
  }

  private setMic(track: MediaStreamTrack | null) {
    const old = this.mic;
    const oldMonitor = this.micMonitorStream;
    this.mic = track;
    if (track) {
      track.enabled = this.micOn;
      track.addEventListener('ended', () => {
        if (this.mic === track && !this.disposed) {
          this.setMic(null);
          void this.startMic();
        }
      });
    }
    this.micStream = track ? new MediaStream([track]) : null;
    this.micMonitorStream = track ? new MediaStream([track.clone()]) : null;
    if (this.micMonitorStream) this.micMonitorStream.getTracks()[0].enabled = true;
    this.onTrack?.('mic', track);
    if (old && old !== track) old.stop();
    oldMonitor?.getTracks().forEach((t) => t.stop());
    this.emit();
  }

  private setCam(track: MediaStreamTrack | null) {
    const old = this.rawCam;
    this.rawCam = track;
    if (track) {
      track.contentHint = '';
      track.addEventListener('ended', () => {
        if (this.rawCam === track && !this.disposed) {
          this.setCam(null);
          if (this.camOn) void this.startCam();
        }
      });
    }
    this.rebuildCamOutput();
    if (old && old !== track) old.stop();
  }

  /** Decide what to send: raw camera, or the effects pipeline wrapped around it. */
  private rebuildCamOutput() {
    const raw = this.rawCam;
    const opts = effectOptions();
    let next: MediaStreamTrack | null = raw;
    if (raw && effectsNeeded(opts)) {
      if (this.pipeline && this.pipeline.input === raw) {
        this.pipeline.setOptions(opts);
        next = this.pipeline.output;
      } else {
        this.pipeline?.stop();
        this.pipeline = new EffectsPipeline(raw, opts);
        next = this.pipeline.output;
      }
    }
    const oldPipeline = this.pipeline && next !== this.pipeline.output ? this.pipeline : null;
    if (oldPipeline) this.pipeline = null;
    if (next !== this.cam) {
      this.cam = next;
      this.camStream = next ? new MediaStream([next]) : null;
      this.onTrack?.('cam', next);
    }
    oldPipeline?.stop();
    if (!raw && this.pipeline) {
      this.pipeline.stop();
      this.pipeline = null;
    }
    this.emit();
  }

  setMicOn(on: boolean) {
    this.micOn = on;
    if (this.mic) this.mic.enabled = on;
    else if (on) void this.startMic(getSettings().micId);
    this.emit();
  }

  async setCamOn(on: boolean) {
    this.camOn = on;
    if (!on) {
      this.camSeq++;
      this.camStarting = false;
      this.setCam(null);
    } else if (!this.rawCam) {
      this.emit();
      await this.startCam(getSettings().camId);
    }
    this.emit();
  }

  async switchMic(deviceId: string) {
    updateSettings({ micId: deviceId });
    await this.startMic(deviceId);
  }

  async switchCam(deviceId: string) {
    updateSettings({ camId: deviceId });
    if (this.camOn) await this.startCam(deviceId);
    else this.emit();
  }

  async reapplyAudioProcessing() {
    if (this.mic) await this.startMic(this.micId);
  }

  // ---------------------------------------------------------------- shared audio (soundboard + screen audio)

  /** What goes out on the "screen audio" channel: the mixer once it exists, else raw screen audio. */
  get audioOut(): MediaStreamTrack | null {
    return this.mixDest?.stream.getAudioTracks()[0] ?? this.screenAudio;
  }

  /** Create the soundboard mixer (needs an AudioContext, so call it after a user click). */
  ensureMixer() {
    if (this.mixDest) return;
    const ctx = getAudioContext();
    this.mixDest = ctx.createMediaStreamDestination();
    this.boardGain = ctx.createGain();
    this.boardGain.connect(this.mixDest);
    this.monitorGain = ctx.createGain();
    this.monitorGain.connect(ctx.destination); // so you hear your own soundboard
    if (this.screenAudio) this.connectScreenAudio(this.screenAudio);
    this.onTrack?.('screenAudio', this.audioOut);
  }

  private connectScreenAudio(track: MediaStreamTrack) {
    this.screenSrc?.disconnect();
    this.screenSrc = getAudioContext().createMediaStreamSource(new MediaStream([track]));
    if (this.mixDest) this.screenSrc.connect(this.mixDest); // not to the monitor: no echo of your own tab
  }

  /** Play a soundboard clip for everyone (works while muted). */
  playSound(id: string, buffer: AudioBuffer) {
    this.ensureMixer();
    const ctx = getAudioContext();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = getSettings().soundboardVolume;
    src.connect(g);
    g.connect(this.boardGain!);
    g.connect(this.monitorGain!);
    src.onended = () => {
      this.sources.delete(src);
      g.disconnect();
      this.playingSounds = new Set(this.sources.values());
      this.emit();
    };
    this.sources.set(src, id);
    this.playingSounds = new Set(this.sources.values());
    src.start();
    this.emit();
  }

  stopSounds() {
    for (const src of [...this.sources.keys()]) {
      try {
        src.stop();
      } catch {
        /* already stopped */
      }
    }
  }

  private teardownMixer() {
    this.stopSounds();
    this.screenSrc?.disconnect();
    this.boardGain?.disconnect();
    this.monitorGain?.disconnect();
    this.mixDest?.stream.getTracks().forEach((t) => t.stop());
    this.mixDest = this.boardGain = this.monitorGain = this.screenSrc = null;
  }

  /** JPEG of the RAW camera (no effects). Used by the ghost-mode easter egg. */
  async captureRawFrame(maxW = 960): Promise<string | null> {
    const t = this.rawCam;
    if (!t) return null;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.srcObject = new MediaStream([t]);
    try {
      await v.play();
      if (!v.videoWidth) await new Promise((r) => v.addEventListener('loadeddata', r, { once: true }));
      await new Promise((r) => setTimeout(r, 120));
      const s = Math.min(1, maxW / v.videoWidth);
      const c = document.createElement('canvas');
      c.width = Math.round(v.videoWidth * s);
      c.height = Math.round(v.videoHeight * s);
      c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    } finally {
      v.srcObject = null;
    }
  }

  async startScreen(): Promise<boolean> {
    if (!this.canShareScreen) {
      this.screenError = { kind: 'unsupported', message: 'Screen sharing is not supported on this device.' };
      this.emit();
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 30 }, width: { max: 2560 }, height: { max: 1440 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        systemAudio: 'include',
        selfBrowserSurface: 'exclude',
      } as DisplayMediaStreamOptions);
      if (this.disposed) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.stopScreen(false);
      const video = stream.getVideoTracks()[0];
      const audio = stream.getAudioTracks()[0] || null;
      video.contentHint = 'detail';
      video.addEventListener('ended', () => {
        if (this.screen === video) this.stopScreen();
      });
      this.screen = video;
      this.screenAudio = audio;
      this.screenStream = new MediaStream([video]);
      this.screenError = null;
      this.onTrack?.('screen', video);
      if (this.mixDest) {
        if (audio) this.connectScreenAudio(audio);
      } else this.onTrack?.('screenAudio', audio);
      this.emit();
      return true;
    } catch (err) {
      const info = describeError(err, 'screen');
      this.screenError = info.kind === 'denied' ? null : info;
      this.emit();
      return false;
    }
  }

  stopScreen(notify = true) {
    const had = this.screen || this.screenAudio;
    this.screen?.stop();
    this.screenAudio?.stop();
    this.screen = null;
    this.screenAudio = null;
    this.screenStream = null;
    this.screenSrc?.disconnect();
    this.screenSrc = null;
    if (had) {
      this.onTrack?.('screen', null);
      if (!this.mixDest) this.onTrack?.('screenAudio', null);
    }
    if (notify) this.emit();
  }

  stopAll() {
    this.disposed = true;
    this.micSeq++;
    this.camSeq++;
    this.micStarting = false;
    this.camStarting = false;
    this.pipeline?.stop();
    this.pipeline = null;
    this.teardownMixer();
    for (const t of [this.mic, this.rawCam, this.cam, this.screen, this.screenAudio]) t?.stop();
    this.micMonitorStream?.getTracks().forEach((t) => t.stop());
    this.mic = this.cam = this.rawCam = this.screen = this.screenAudio = null;
    this.micStream = this.camStream = this.screenStream = this.micMonitorStream = null;
    this.emit();
  }

  dispose() {
    this.stopAll();
    this.unsubSettings?.();
    this.unsubSettings = null;
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.refreshDevices);
  }
}
