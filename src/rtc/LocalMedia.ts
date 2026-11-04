import { Emitter } from '../lib/emitter';
import { getSettings, updateSettings } from '../lib/settings';

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

/**
 * Owns this user's tracks: mic, camera, screen (+ screen audio), device lists and
 * device errors. MeetingSession listens to `onTrack` and swaps tracks into every
 * peer connection with replaceTrack, so device switches never renegotiate.
 */
export class LocalMedia extends Emitter {
  mic: MediaStreamTrack | null = null;
  cam: MediaStreamTrack | null = null;
  screen: MediaStreamTrack | null = null;
  screenAudio: MediaStreamTrack | null = null;

  /** What the user wants, independent of whether a track exists right now. */
  micOn = true;
  camOn = true;

  micError: MediaErrorInfo | null = null;
  camError: MediaErrorInfo | null = null;
  screenError: MediaErrorInfo | null = null;

  devices: MediaDeviceInfo[] = [];
  micStarting = false;
  camStarting = false;

  /** Streams handed to <video> elements; rebuilt whenever the track changes. */
  camStream: MediaStream | null = null;
  screenStream: MediaStream | null = null;
  micStream: MediaStream | null = null;

  onTrack: ((slot: TrackSlot, track: MediaStreamTrack | null) => void) | null = null;

  private micSeq = 0;
  private camSeq = 0;
  private disposed = false;

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
    return this.cam?.getSettings().deviceId || getSettings().camId;
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

  /** Start whatever the user wants on. Safe to call repeatedly. */
  async start() {
    this.disposed = false;
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
      this.camOn && !this.cam ? this.startCam(getSettings().camId) : null,
    ]);
    await this.refreshDevices();
  }

  /** "Try again" after a permission/device error. */
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
    };
  }

  private videoConstraints(deviceId?: string): MediaTrackConstraints {
    return {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 30, max: 30 },
    };
  }

  /** getUserMedia with a retry on the default device if the saved one is gone. */
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
    this.mic = track;
    if (track) {
      track.enabled = this.micOn;
      track.addEventListener('ended', () => {
        // Device unplugged: fall back to the default mic.
        if (this.mic === track && !this.disposed) {
          this.setMic(null);
          void this.startMic();
        }
      });
    }
    this.micStream = track ? new MediaStream([track]) : null;
    this.onTrack?.('mic', track);
    if (old && old !== track) old.stop();
    this.emit();
  }

  private setCam(track: MediaStreamTrack | null) {
    const old = this.cam;
    this.cam = track;
    if (track) {
      track.contentHint = 'motion';
      track.addEventListener('ended', () => {
        if (this.cam === track && !this.disposed) {
          this.setCam(null);
          if (this.camOn) void this.startCam();
        }
      });
    }
    this.camStream = track ? new MediaStream([track]) : null;
    this.onTrack?.('cam', track);
    if (old && old !== track) old.stop();
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
      this.camSeq++; // cancel any in-flight start
      this.camStarting = false;
      this.setCam(null); // stops the track so the camera light turns off
    } else if (!this.cam) {
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

  /** Re-acquire the mic so new echo/noise/gain settings apply. */
  async reapplyAudioProcessing() {
    if (this.mic) await this.startMic(this.micId);
  }

  async startScreen(): Promise<boolean> {
    if (!this.canShareScreen) {
      this.screenError = { kind: 'unsupported', message: 'Screen sharing is not supported on this device.' };
      this.emit();
      return false;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 15, max: 30 } },
        // Tab audio everywhere; whole-system audio on Windows/ChromeOS Chrome/Edge.
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
      this.onTrack?.('screenAudio', audio);
      this.emit();
      return true;
    } catch (err) {
      const info = describeError(err, 'screen');
      // Cancelling the picker is not an error worth showing.
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
    if (had) {
      this.onTrack?.('screen', null);
      this.onTrack?.('screenAudio', null);
    }
    if (notify) this.emit();
  }

  /** Stop every track and forget them. The instance can be started again later. */
  stopAll() {
    this.disposed = true;
    this.micSeq++;
    this.camSeq++;
    this.micStarting = false;
    this.camStarting = false;
    for (const t of [this.mic, this.cam, this.screen, this.screenAudio]) t?.stop();
    this.mic = this.cam = this.screen = this.screenAudio = null;
    this.micStream = this.camStream = this.screenStream = null;
    this.emit();
  }

  dispose() {
    this.stopAll();
    navigator.mediaDevices?.removeEventListener?.('devicechange', this.refreshDevices);
  }
}
