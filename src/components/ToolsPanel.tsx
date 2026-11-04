import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  Camera,
  Captions,
  Circle,
  Coins,
  Dices,
  FileText,
  Ghost,
  PartyPopper,
  Pencil,
  PenTool,
  Plane,
  Plus,
  Sparkles,
  Square,
  Timer,
  Upload,
  X,
} from 'lucide-react';
import type { TimerStore } from '../rtc/collab';
import { formatClock } from '../rtc/collab';
import type { CaptionsStore } from '../rtc/captions';
import { captionsSupported } from '../rtc/captions';
import { VOICES } from '../rtc/voice';
import { formatElapsed } from '../rtc/recorder';
import { useNow } from '../lib/hooks';
import type { LocalMedia } from '../rtc/LocalMedia';
import type { MeetingSession } from '../rtc/MeetingSession';
import { useEmitter } from '../lib/hooks';
import { updateSettings, useSettings } from '../lib/settings';
import { getAudioContext } from '../lib/sounds';
import {
  BUILTIN_SOUNDS,
  MAX_SOUND_SECONDS,
  addCustomSound,
  getSoundBuffer,
  listCustomSounds,
  removeCustomSound,
  renameCustomSound,
  type SoundItem,
} from '../lib/soundboard';
import { useToast } from './Toast';

/** Side panel with the soundboard and every fun effect (easter eggs included). */
export function ToolsPanel({
  session,
  local,
  onClose,
  onGhost,
  features,
}: {
  session: MeetingSession;
  local: LocalMedia;
  onClose: () => void;
  onGhost: () => void;
  features: {
    openWhiteboard: () => void;
    openPolls: () => void;
    timer: TimerStore;
    captions: CaptionsStore;
    captionsOn: boolean;
    toggleCaptions: () => void;
    recording: boolean;
    recordStart: number;
    toggleRecording: () => void;
    groupPhoto: () => void;
  };
}) {
  useEmitter(features.timer);
  useEmitter(features.captions);
  const now = useNow(500);
  const [customMin, setCustomMin] = useState('');
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const [custom, setCustom] = useState<SoundItem[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => void listCustomSounds().then(setCustom), []);
  useEffect(refresh, [refresh]);

  const pads = [...BUILTIN_SOUNDS, ...custom];

  const play = useCallback(
    async (item: SoundItem) => {
      const buf = await getSoundBuffer(item.id, getAudioContext());
      if (!buf) {
        toast(`Couldn't play "${item.name}"`, 'error');
        return;
      }
      local.playSound(item.id, buf);
    },
    [local, toast],
  );

  // Number keys 1-9 trigger the first nine pads while this panel is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || e.ctrlKey || e.metaKey || e.altKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && pads[n - 1]) {
        e.preventDefault();
        void play(pads[n - 1]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pads, play]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    for (const f of Array.from(files)) {
      try {
        const item = await addCustomSound(f, getAudioContext());
        toast(`Added "${item.name}" to your soundboard`, 'success');
      } catch (err) {
        toast((err as Error).message, 'error');
      }
    }
    setBusy(false);
    if (file.current) file.current.value = '';
    refresh();
  };

  return (
    <aside className="side-panel tools-panel" aria-label="Tools" data-testid="tools-panel">
      <div className="side-head">
        <h2>Tools</h2>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close tools">
          <X size={20} />
        </button>
      </div>

      <div className="tools-scroll">
        <section className="tools-section">
          <h3>Collaborate</h3>
          <div className="fun-grid">
            <button className="fun-btn" onClick={features.openWhiteboard} data-testid="tool-whiteboard">
              <PenTool size={20} />
              <span>Whiteboard</span>
            </button>
            <button className="fun-btn" onClick={features.openPolls} data-testid="tool-polls">
              <BarChart3 size={20} />
              <span>Polls</span>
            </button>
            <button
              className={`fun-btn ${features.captionsOn ? 'on' : ''}`}
              onClick={features.toggleCaptions}
              disabled={!captionsSupported()}
              title={captionsSupported() ? '' : 'Live captions need Chrome or Edge'}
              data-testid="tool-captions"
            >
              <Captions size={20} />
              <span>{features.captionsOn ? 'Captions on' : 'Live captions'}</span>
            </button>
            <button className="fun-btn" onClick={() => features.captions.downloadTranscript(session.code)} data-testid="tool-transcript">
              <FileText size={20} />
              <span>Transcript ({features.captions.transcript.length})</span>
            </button>
          </div>
          {features.captions.error && <p className="error-text">{features.captions.error}</p>}
        </section>

        <section className="tools-section">
          <div className="tools-title">
            <h3>Timer</h3>
            {features.timer.running && (
              <button className="btn btn-small btn-ghost" onClick={() => features.timer.stop()} data-testid="timer-stop">
                <Square size={12} /> Stop
              </button>
            )}
          </div>
          {features.timer.running ? (
            <div className="timer-big" data-testid="timer-big">
              <Timer size={20} /> {formatClock(features.timer.remaining)}
              <span className="muted small">started by {features.timer.startedBy}</span>
            </div>
          ) : (
            <div className="timer-presets">
              {[1, 3, 5, 10, 15].map((m) => (
                <button key={m} className="btn btn-small btn-ghost" onClick={() => features.timer.start(m * 60_000)} data-testid={`timer-${m}`}>
                  {m} min
                </button>
              ))}
              <form
                className="timer-custom"
                onSubmit={(e) => {
                  e.preventDefault();
                  const m = parseFloat(customMin);
                  if (m > 0) features.timer.start(Math.round(m * 60_000));
                  setCustomMin('');
                }}
              >
                <input value={customMin} onChange={(e) => setCustomMin(e.target.value)} placeholder="min" inputMode="decimal" aria-label="Custom minutes" />
                <button className="btn btn-small" type="submit">
                  Go
                </button>
              </form>
            </div>
          )}
          <p className="muted small">Everyone sees the countdown and hears a chime at zero.</p>
        </section>

        <section className="tools-section">
          <h3>Capture</h3>
          <div className="fun-grid">
            <button className={`fun-btn ${features.recording ? 'rec' : ''}`} onClick={features.toggleRecording} data-testid="tool-record">
              {features.recording ? <Square size={20} /> : <Circle size={20} />}
              <span>{features.recording ? `Stop ${formatElapsed(now - features.recordStart)}` : 'Record call'}</span>
            </button>
            <button className="fun-btn" onClick={features.groupPhoto} data-testid="tool-photo">
              <Camera size={20} />
              <span>Group photo</span>
            </button>
          </div>
          <p className="muted small">Recordings are saved to your computer as a video file. Everyone is shown that you're recording.</p>
        </section>

        <section className="tools-section">
          <h3>Voice changer</h3>
          <div className="voice-grid" data-testid="voice-grid">
            {VOICES.map((v) => (
              <button
                key={v.id}
                className={`voice-opt ${s.voiceFx === v.id ? 'sel' : ''}`}
                onClick={() => updateSettings({ voiceFx: v.id })}
                data-testid={`voice-${v.id}`}
              >
                <span>{v.emoji}</span>
                {v.label}
              </button>
            ))}
          </div>
          <p className="muted small">Everyone hears the changed voice.</p>
        </section>

        <section className="tools-section">
          <div className="tools-title">
            <h3>Soundboard</h3>
            {local.playingSounds.size > 0 && (
              <button className="btn btn-small btn-danger" onClick={() => local.stopSounds()} data-testid="sound-stop">
                <Square size={12} /> Stop
              </button>
            )}
          </div>
          <p className="side-note">Everyone hears these, even while you're muted. Keys 1-9 play the first nine.</p>
          <label className="field range-field compact-field">
            <span>Volume · {Math.round(s.soundboardVolume * 100)}%</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={s.soundboardVolume}
              onChange={(e) => updateSettings({ soundboardVolume: Number(e.target.value) })}
            />
          </label>
          <div className="pad-grid" data-testid="pad-grid">
            {pads.map((p, i) => (
              <div key={p.id} className={`pad ${local.playingSounds.has(p.id) ? 'playing' : ''}`}>
                {editing === p.id ? (
                  <form
                    className="pad-edit"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const fd = new FormData(e.currentTarget);
                      await renameCustomSound(p.id, String(fd.get('name') || ''), String(fd.get('emoji') || ''));
                      setEditing(null);
                      refresh();
                    }}
                  >
                    <input name="emoji" defaultValue={p.emoji} maxLength={4} aria-label="Emoji" className="pad-emoji-input" />
                    <input name="name" defaultValue={p.name} maxLength={24} aria-label="Name" autoFocus />
                    <button className="btn btn-small" type="submit">
                      Save
                    </button>
                  </form>
                ) : (
                  <>
                    <button className="pad-hit" onClick={() => void play(p)} data-testid={`pad-${p.id}`} title={`Play ${p.name}`}>
                      <span className="pad-emoji">{p.emoji}</span>
                      <span className="pad-name">{p.name}</span>
                      {i < 9 && <span className="pad-key">{i + 1}</span>}
                    </button>
                    {!p.builtin && (
                      <div className="pad-tools">
                        <button onClick={() => setEditing(p.id)} aria-label={`Rename ${p.name}`} title="Rename">
                          <Pencil size={11} />
                        </button>
                        <button
                          onClick={async () => {
                            await removeCustomSound(p.id);
                            refresh();
                          }}
                          aria-label={`Delete ${p.name}`}
                          title="Delete"
                        >
                          <X size={11} />
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            <button className="pad pad-add" onClick={() => file.current?.click()} disabled={busy} data-testid="sound-upload">
              {busy ? <Upload size={18} className="spin" /> : <Plus size={20} />}
              <span className="pad-name">Upload</span>
            </button>
          </div>
          <input
            ref={file}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a"
            multiple
            hidden
            onChange={(e) => void upload(e.target.files)}
            data-testid="sound-file"
          />
          <p className="muted small">MP3, WAV, OGG or M4A, up to 3 MB and {MAX_SOUND_SECONDS} s. Saved on this device only.</p>
        </section>

        <section className="tools-section">
          <h3>Fun</h3>
          <div className="fun-grid">
            <button className="fun-btn" onClick={() => session.sendFx('confetti')} data-testid="tool-confetti">
              <Sparkles size={20} />
              <span>Confetti</span>
            </button>
            <button className="fun-btn" onClick={() => session.sendFx('party')} data-testid="tool-party">
              <PartyPopper size={20} />
              <span>Party mode</span>
            </button>
            <button className="fun-btn" onClick={() => session.sendFx('barrelroll')} data-testid="tool-barrelroll">
              <Plane size={20} />
              <span>Barrel roll</span>
            </button>
            <button className="fun-btn" onClick={onGhost} data-testid="tool-ghost">
              <Ghost size={20} />
              <span>Ghost Protocol</span>
            </button>
            <button className="fun-btn" onClick={() => session.sendChat(`🎲 rolled ${1 + Math.floor(Math.random() * 6)} (1-6)`)} data-testid="tool-dice">
              <Dices size={20} />
              <span>Roll a die</span>
            </button>
            <button className="fun-btn" onClick={() => session.sendChat(`🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`)} data-testid="tool-coin">
              <Coins size={20} />
              <span>Flip a coin</span>
            </button>
          </div>
          <p className="muted small">Confetti, party mode and barrel rolls happen on everyone's screen.</p>
        </section>
      </div>
    </aside>
  );
}
