import { Emitter } from '../lib/emitter';
import { randomId } from '../lib/crypto';
import { getSettings, subscribeSettings } from '../lib/settings';
import type { LocalMedia } from './LocalMedia';
import type { MeetingSession, SessionEvent } from './MeetingSession';

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

const Recognition = (): (new () => SpeechRecognitionLike) | undefined =>
  (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike })
    .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition;

export const captionsSupported = () => !!Recognition();

export interface CaptionLine {
  speaker: string;
  name: string;
  text: string;
  final: boolean;
  ts: number;
}

type CcMsg = { id: string; text: string; final: boolean };

/**
 * Live captions. Every participant transcribes only their OWN microphone (browser
 * speech recognition), and shares the text while anyone in the call wants captions.
 * Note: Chrome/Edge send the audio to their speech service to do the recognition.
 */
export class CaptionsStore extends Emitter {
  /** Latest caption per speaker. */
  lines = new Map<string, CaptionLine>();
  transcript: { name: string; text: string; ts: number }[] = [];
  transcribing = false;
  error = '';
  version = 0;
  private rec: SpeechRecognitionLike | null = null;
  private wantRunning = false;
  private segId = randomId(4);
  private lastSent = 0;
  private restartTimer: number | null = null;
  private pruneTimer: number;
  private offs: (() => void)[] = [];

  constructor(
    private session: MeetingSession,
    private local: LocalMedia,
  ) {
    super();
    this.offs.push(
      session.onEvent((e: SessionEvent) => {
        if (e.type === 'captions') this.update();
        else if (e.type === 'app' && e.kind === 'cc') this.applyRemote(e.data as CcMsg, e.from, e.name);
      }),
      local.subscribe(() => this.update()),
      subscribeSettings(() => this.update()),
    );
    this.pruneTimer = window.setInterval(() => this.prune(), 1000);
    this.update();
  }

  dispose() {
    this.offs.forEach((f) => f());
    clearInterval(this.pruneTimer);
    this.stopRec();
  }

  private bump() {
    this.version++;
    this.emit();
  }

  /** Start/stop our own recognizer to match: anyone wants captions + our mic is live + allowed. */
  update() {
    const should =
      this.session.anyoneWantsCaptions() && getSettings().shareCaptions && captionsSupported() && !!this.local.mic && this.local.micOn;
    if (should && !this.wantRunning) this.startRec();
    else if (!should && this.wantRunning) this.stopRec();
  }

  private startRec() {
    const R = Recognition();
    if (!R) return;
    this.wantRunning = true;
    const rec = new R();
    rec.lang = getSettings().captionsLang || navigator.language || 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interim = '';
      let final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else interim += r[0].transcript;
      }
      const now = Date.now();
      if (final.trim()) {
        this.publish(final.trim(), true);
        this.segId = randomId(4);
      } else if (interim.trim() && now - this.lastSent > 250) {
        this.lastSent = now;
        this.publish(interim.trim(), false);
      }
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.error = 'Captions are blocked in this browser (speech recognition not allowed).';
        this.wantRunning = false;
      } else if (e.error === 'network') {
        this.error = 'Captions need an internet connection to the browser\'s speech service.';
      } else if (e.error === 'language-not-supported') {
        this.error = 'That caption language is not supported here.';
        this.wantRunning = false;
      }
      this.bump();
    };
    rec.onend = () => {
      this.rec = null;
      this.transcribing = false;
      this.bump();
      // Recognition stops on its own after silence; keep it going while wanted.
      if (this.wantRunning) this.restartTimer = window.setTimeout(() => this.wantRunning && this.restart(), 400);
    };
    try {
      rec.start();
      this.rec = rec;
      this.transcribing = true;
      this.error = '';
    } catch {
      this.wantRunning = false;
    }
    this.bump();
  }

  private restart() {
    this.wantRunning = false;
    this.startRec();
  }

  private stopRec() {
    this.wantRunning = false;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    try {
      this.rec?.abort();
    } catch {
      /* ignore */
    }
    this.rec = null;
    this.transcribing = false;
    this.bump();
  }

  private publish(text: string, final: boolean) {
    const me = this.session.getSnapshot().participants[0];
    this.setLine(this.session.selfId, me?.name ?? 'You', text, final);
    this.session.sendApp('cc', { id: this.segId, text: text.slice(0, 500), final } satisfies CcMsg);
  }

  private applyRemote(m: CcMsg, from: string, name: string) {
    if (!m || typeof m.text !== 'string') return;
    this.setLine(from, name, m.text.slice(0, 500), !!m.final);
  }

  private setLine(speaker: string, name: string, text: string, final: boolean) {
    this.lines.set(speaker, { speaker, name, text, final, ts: Date.now() });
    if (final) this.transcript.push({ name, text, ts: Date.now() });
    if (this.transcript.length > 5000) this.transcript.shift();
    this.bump();
  }

  private prune() {
    const now = Date.now();
    let changed = false;
    for (const [k, l] of this.lines) {
      if (now - l.ts > (l.final ? 5000 : 8000)) {
        this.lines.delete(k);
        changed = true;
      }
    }
    if (changed) this.bump();
  }

  downloadTranscript(code: string) {
    const body = this.transcript
      .map((t) => `[${new Date(t.ts).toLocaleTimeString()}] ${t.name}: ${t.text}`)
      .join('\n');
    const blob = new Blob([`Yapameet transcript - ${code} - ${new Date().toLocaleString()}\n\n${body || '(no captions yet)'}\n`], {
      type: 'text/plain',
    });
    downloadBlob(blob, `yapameet-${code}-transcript.txt`);
  }
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
