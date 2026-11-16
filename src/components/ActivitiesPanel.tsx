import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  AudioLines,
  BarChart3,
  Clapperboard,
  Coins,
  Dices,
  Gamepad2,
  Ghost,
  Headphones,
  Link2,
  Music4,
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
import type { PollStore, TimerStore } from '../rtc/collab';
import { formatClock } from '../rtc/collab';
import { VOICES } from '../rtc/voice';
import type { LocalMedia } from '../rtc/LocalMedia';
import type { MeetingSession, Participant } from '../rtc/MeetingSession';
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
import { PollsView } from './PollsPanel';
import { GamesView } from './GameUI';
import type { DrawGuessStore, FunStore } from '../rtc/games';
import { Toggle } from './controls';
import { parseWatchUrl, type WatchStore } from '../rtc/watch';
import { useToast } from './Toast';

export type ActivityView = 'home' | 'games' | 'watch' | 'polls' | 'timer' | 'soundboard' | 'voice';

export interface ActivityFeatures {
  openWhiteboard: () => void;
  openEffects: () => void;
  polls: PollStore;
  timer: TimerStore;
  openGhost: () => void;
  watch: WatchStore;
  openWatch: () => void;
  dg: DrawGuessStore;
  fun: FunStore;
}

export const ACTIVITY_TITLES: Record<ActivityView, string> = {
  home: 'Activities',
  games: 'Games',
  watch: 'Watch together',
  polls: 'Polls',
  timer: 'Timer',
  soundboard: 'Soundboard',
  voice: 'Voice changer',
};

type TileId = Exclude<ActivityView, 'home'> | 'whiteboard' | 'effects';

/** Activities: a launcher grid at home; every activity gets its own page. */
export function ActivitiesPanel({
  session,
  local,
  participants,
  view,
  onView,
  features,
}: {
  session: MeetingSession;
  local: LocalMedia;
  participants: Participant[];
  view: ActivityView;
  onView: (v: ActivityView) => void;
  features: ActivityFeatures;
}) {
  useEmitter(features.timer);
  useEmitter(features.polls);
  useEmitter(features.watch);
  useEmitter(features.dg);
  useEmitter(local);
  const s = useSettings();

  if (view !== 'home') {
    return (
      <div className="side-content" data-testid="activities-panel" data-view={view}>
        <div className="tools-scroll">
          {view === 'polls' && <PollsView store={features.polls} participants={participants} selfId={session.selfId} />}
          {view === 'timer' && <TimerView timer={features.timer} />}
          {view === 'soundboard' && <SoundboardView local={local} />}
          {view === 'voice' && <VoiceView local={local} />}
          {view === 'watch' && <WatchPage features={features} />}
          {view === 'games' && (
            <>
              <GamesView dg={features.dg} fun={features.fun} polls={features.polls} participants={participants} />
              <FunView session={session} features={features} />
            </>
          )}
        </div>
      </div>
    );
  }

  const openPolls = features.polls.polls.filter((p) => !p.ended).length;
  const voice = VOICES.find((v) => v.id === s.voiceFx);
  const fxOn = s.bgEffect !== 'none' || s.filter !== 'none' || s.sticker !== 'none' || s.autoFrame || s.lowLightBoost;
  const tiles: { id: TileId; title: string; sub: string; icon: ReactNode; color: string; status?: string }[] = [
    {
      id: 'games',
      title: 'Games',
      sub: 'Draw & Guess and more',
      icon: <Gamepad2 size={22} />,
      color: '#a78bfa',
      status: features.dg.active ? `Round ${features.dg.round}/${features.dg.total}` : undefined,
    },
    {
      id: 'watch',
      title: 'Watch together',
      sub: 'YouTube and videos',
      icon: <Clapperboard size={22} />,
      color: '#fb7185',
      status: features.watch.src ? (features.watch.playing ? 'Playing' : 'Paused') : undefined,
    },
    { id: 'whiteboard', title: 'Whiteboard', sub: 'Draw together', icon: <PenTool size={22} />, color: '#fbbf24' },
    { id: 'polls', title: 'Polls', sub: 'Ask the room', icon: <BarChart3 size={22} />, color: '#38bdf8', status: openPolls ? `${openPolls} open` : undefined },
    {
      id: 'soundboard',
      title: 'Soundboard',
      sub: 'Sounds for everyone',
      icon: <Music4 size={22} />,
      color: '#f472b6',
      status: local.playingSounds.size ? 'Playing' : undefined,
    },
    {
      id: 'voice',
      title: 'Voice changer',
      sub: 'Sound like a robot',
      icon: <AudioLines size={22} />,
      color: '#818cf8',
      status: voice && voice.id !== 'none' ? `${voice.emoji} ${voice.label}` : undefined,
    },
    { id: 'effects', title: 'Effects', sub: 'Stickers, blur, filters', icon: <Sparkles size={22} />, color: '#fb923c', status: fxOn ? 'On' : undefined },
    {
      id: 'timer',
      title: 'Timer',
      sub: 'Shared countdown',
      icon: <Timer size={22} />,
      color: '#34d399',
      status: features.timer.running ? formatClock(features.timer.remaining) : undefined,
    },
  ];

  return (
    <div className="side-content" data-testid="activities-panel" data-view="home">
      <div className="tools-scroll">
        <div className="act-grid">
          {tiles.map((t) => (
            <button
              key={t.id}
              className={`act-tile ${t.status ? 'live' : ''}`}
              style={{ ['--c' as string]: t.color }}
              onClick={() => (t.id === 'whiteboard' ? features.openWhiteboard() : t.id === 'effects' ? features.openEffects() : onView(t.id))}
              data-testid={`act-${t.id}`}
            >
              <span className="act-icon">{t.icon}</span>
              <b>{t.title}</b>
              <small>{t.sub}</small>
              {t.status && <span className="act-status">{t.status}</span>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- pages

function TimerView({ timer }: { timer: TimerStore }) {
  useEmitter(timer);
  const [customMin, setCustomMin] = useState('');
  return (
    <section className="tools-section">
      {timer.running ? (
        <div className="timer-live">
          <div className="timer-big" data-testid="timer-big">
            {formatClock(timer.remaining)}
          </div>
          <p className="muted small">Started by {timer.startedBy}</p>
          <button className="btn btn-ghost" onClick={() => timer.stop()} data-testid="timer-stop">
            <Square size={14} /> Stop for everyone
          </button>
        </div>
      ) : (
        <>
          <div className="timer-presets">
            {[1, 3, 5, 10, 15, 30].map((m) => (
              <button key={m} className="btn btn-ghost" onClick={() => timer.start(m * 60_000)} data-testid={`timer-${m}`}>
                {m} min
              </button>
            ))}
          </div>
          <form
            className="timer-custom"
            onSubmit={(e) => {
              e.preventDefault();
              const m = parseFloat(customMin);
              if (m > 0) timer.start(Math.round(m * 60_000));
              setCustomMin('');
            }}
          >
            <input value={customMin} onChange={(e) => setCustomMin(e.target.value)} placeholder="Custom minutes" inputMode="decimal" aria-label="Custom minutes" />
            <button className="btn" type="submit" disabled={!(parseFloat(customMin) > 0)}>
              Start
            </button>
          </form>
        </>
      )}
      <p className="muted small">Everyone sees the countdown at the top of the call and hears a chime at zero.</p>
    </section>
  );
}

function WatchPage({ features }: { features: ActivityFeatures }) {
  const w = features.watch;
  useEmitter(w);
  const [link, setLink] = useState('');
  const [err, setErr] = useState('');
  const start = () => {
    const src = parseWatchUrl(link);
    if (!src) {
      setErr('Paste a YouTube link, a catbox.moe / litterbox link, or a direct https link to an .mp4 / .webm video.');
      return;
    }
    setErr('');
    setLink('');
    w.load(src);
    features.openWatch();
  };
  return (
    <section className="tools-section">
      {w.src && (
        <div className="watch-now" data-testid="watch-now">
          <b>{w.playing ? 'Now playing' : 'Paused'}</b>
          <span>{w.src.title}</span>
          <small className="muted">Started by {w.startedBy}</small>
          <div className="btn-row">
            <button className="btn btn-small" onClick={features.openWatch}>
              <Clapperboard size={14} /> Open player
            </button>
            <button className="btn btn-small btn-ghost" onClick={() => w.stop()}>
              <Square size={12} /> Stop for everyone
            </button>
          </div>
        </div>
      )}
      <form
        className="watch-form"
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <label className="field">
          <span>{w.src ? 'Play something else' : 'Video link'}</span>
          <div className="row-with-button">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://youtu.be/…" data-testid="watch-url" />
            <button className="btn btn-primary" type="submit" disabled={!link.trim()} data-testid="watch-start">
              <Link2 size={15} /> Watch
            </button>
          </div>
        </label>
      </form>
      {err && <p className="error-text">{err}</p>}
      <p className="muted small">
        Everyone gets the player. Play, pause and seeking are shared, and late joiners jump to the right spot. For your own movies, upload them to
        catbox.moe (permanent) or litterbox (temporary) and paste the file link.
      </p>
    </section>
  );
}

function VoiceView({ local }: { local: LocalMedia }) {
  useEmitter(local);
  const s = useSettings();
  return (
    <section className="tools-section">
      <div className="voice-grid" data-testid="voice-grid">
        {VOICES.map((v) => (
          <button key={v.id} className={`voice-opt ${s.voiceFx === v.id ? 'sel' : ''}`} onClick={() => updateSettings({ voiceFx: v.id })} data-testid={`voice-${v.id}`}>
            <span>{v.emoji}</span>
            {v.label}
          </button>
        ))}
      </div>
      <p className="muted small">Everyone hears the changed voice. Pick Normal to go back.</p>
      <div className="hear-row">
        <Headphones size={18} />
        <Toggle
          label="Hear myself"
          hint="Plays your voice back to you. Use headphones or you'll get an echo."
          checked={local.hearMyself}
          onChange={(v) => local.setHearMyself(v)}
          testId="hear-myself"
        />
      </div>
    </section>
  );
}

function FunView({ session, features }: { session: MeetingSession; features: ActivityFeatures }) {
  const items: { label: string; icon: ReactNode; on: () => void; id: string }[] = [
    { label: 'Confetti', icon: <Sparkles size={18} />, on: () => session.sendFx('confetti'), id: 'tool-confetti' },
    { label: 'Party mode', icon: <PartyPopper size={18} />, on: () => session.sendFx('party'), id: 'tool-party' },
    { label: 'Barrel roll', icon: <Plane size={18} />, on: () => session.sendFx('barrelroll'), id: 'tool-barrelroll' },
    { label: 'Ghost Protocol', icon: <Ghost size={18} />, on: features.openGhost, id: 'tool-ghost' },
    { label: 'Roll a die', icon: <Dices size={18} />, on: () => session.sendChat(`🎲 rolled ${1 + Math.floor(Math.random() * 6)} (1-6)`), id: 'tool-dice' },
    { label: 'Flip a coin', icon: <Coins size={18} />, on: () => session.sendChat(`🪙 ${Math.random() < 0.5 ? 'Heads' : 'Tails'}`), id: 'tool-coin' },
  ];
  return (
    <section className="tools-section">
      <h3>Quick fun</h3>
      <div className="fun-grid">
        {items.map((i) => (
          <button key={i.id} className="fun-btn" onClick={i.on} data-testid={i.id}>
            {i.icon}
            <span>{i.label}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Confetti, party mode and barrel rolls happen on everyone's screen. Dice and coins post in chat.</p>
    </section>
  );
}

function SoundboardView({ local }: { local: LocalMedia }) {
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

  // Number keys 1-9 trigger the first nine pads while the soundboard is open.
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
    <section className="tools-section">
      <div className="tools-title">
        <label className="field range-field compact-field grow">
          <span>Volume · {Math.round(s.soundboardVolume * 100)}%</span>
          <input type="range" min={0} max={1} step={0.05} value={s.soundboardVolume} onChange={(e) => updateSettings({ soundboardVolume: Number(e.target.value) })} />
        </label>
        {local.playingSounds.size > 0 && (
          <button className="btn btn-small btn-danger" onClick={() => local.stopSounds()} data-testid="sound-stop">
            <Square size={12} /> Stop
          </button>
        )}
      </div>
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
      <input ref={file} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a" multiple hidden onChange={(e) => void upload(e.target.files)} data-testid="sound-file" />
      <p className="muted small">
        Everyone hears these, even while you're muted. Keys 1-9 play the first nine. Uploads: MP3, WAV, OGG or M4A, up to 3 MB and {MAX_SOUND_SECONDS} s,
        saved on this device only.
      </p>
    </section>
  );
}
