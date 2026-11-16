import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Check, Egg, ImagePlus, Lock, Mic, Palette, RotateCcw, SlidersHorizontal, Sparkles, Speaker, User, Video, Volume2, X } from 'lucide-react';
import type { LocalMedia } from '../rtc/LocalMedia';
import type { MeetingSession } from '../rtc/MeetingSession';
import { useEmitter } from '../lib/hooks';
import { QUALITY, resetSettings, updateSettings, useSettings, type CodecPref, type FilterId, type Settings, type VideoQuality } from '../lib/settings';
import { setSoundsSink, sounds } from '../lib/sounds';
import { audioLevels } from '../lib/audioLevel';
import { BG_PRESETS, MAX_CUSTOM, addCustomBg, getCustomBgs, presetThumb, removeCustomBg } from '../lib/backgrounds';
import { FILTERS, cssFilterFor } from '../rtc/effects';
import { supportedCodecs } from '../rtc/tuning';
import { STICKERS } from '../rtc/faceStickers';
import { captionsSupported } from '../rtc/captions';
import { EGGS, THEMES } from '../lib/themes';
import { DeviceSelect, Toggle } from './controls';
import { LevelMeter, VideoView, supportsSinkSelection } from './media';
import { PfpEditor } from './PfpEditor';
import { useToast } from './Toast';

const METER_ID = '__settings-mic';

export type SettingsSection = 'profile' | 'appearance' | 'audio' | 'video' | 'effects' | 'calls' | 'secrets';

const GROUPS: { title: string; items: { id: SettingsSection; label: string; title?: string; icon: ReactNode }[] }[] = [
  {
    title: 'You',
    items: [
      { id: 'profile', label: 'Profile', icon: <User size={18} /> },
      { id: 'appearance', label: 'Appearance', icon: <Palette size={18} /> },
    ],
  },
  {
    title: 'Devices',
    items: [
      { id: 'audio', label: 'Audio', icon: <Mic size={18} /> },
      { id: 'video', label: 'Video', icon: <Video size={18} /> },
      { id: 'effects', label: 'Effects', title: 'Backgrounds & effects', icon: <Sparkles size={18} /> },
    ],
  },
  {
    title: 'More',
    items: [
      { id: 'calls', label: 'Calls', icon: <SlidersHorizontal size={18} /> },
      { id: 'secrets', label: 'Secrets', icon: <Egg size={18} /> },
    ],
  },
];
export const SETTINGS_SECTIONS = GROUPS.flatMap((g) => g.items);

/** Which sections need the camera or microphone running to be useful. */
export const sectionNeedsDevices = (s: SettingsSection) => s === 'audio' || s === 'video' || s === 'effects';

/**
 * The whole settings UI: section list on the left, the chosen section on the right.
 * Used by the Settings page and by the settings window inside a call or the lobby.
 */
export function SettingsView({
  local,
  section,
  onSection,
  session,
}: {
  local: LocalMedia;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  /** Set while in a call: a name change is announced to everyone. */
  session?: MeetingSession;
}) {
  const s = useSettings();
  const current = SETTINGS_SECTIONS.find((x) => x.id === section) ?? SETTINGS_SECTIONS[0];
  return (
    <div className="settings" data-testid="settings-view" data-section={current.id}>
      <nav className="settings-nav" aria-label="Settings sections" role="tablist">
        {GROUPS.map((g) => (
          <div className="settings-nav-group" key={g.title}>
            <div className="settings-nav-title">{g.title}</div>
            {g.items.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={current.id === x.id}
                className={current.id === x.id ? 'active' : ''}
                onClick={() => onSection(x.id)}
                data-testid={`section-${x.id}`}
              >
                {x.icon}
                <span>{x.label}</span>
                {x.id === 'secrets' && (
                  <span className="nav-count">
                    {s.eggs.length}/{EGGS.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </nav>
      <div className="settings-body" key={current.id}>
        <h2 className="settings-title">{current.title ?? current.label}</h2>
        {current.id === 'profile' && <ProfilePanel local={local} session={session} />}
        {current.id === 'appearance' && <AppearancePanel />}
        {current.id === 'audio' && <AudioPanel local={local} />}
        {current.id === 'video' && <VideoPanel local={local} />}
        {current.id === 'effects' && <EffectsPanel local={local} />}
        {current.id === 'calls' && <CallsPanel session={session} />}
        {current.id === 'secrets' && <SecretsPanel />}
      </div>
    </div>
  );
}

function Select<T extends string>({
  label,
  value,
  options,
  onChange,
  hint,
  testId,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  hint?: string;
  testId?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value as T)} data-testid={testId}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint && <small className="muted">{hint}</small>}
    </label>
  );
}

function PermissionNotice({ local }: { local: LocalMedia }) {
  const needsPermission = local.devices.length > 0 && local.devices.every((d) => !d.label);
  if (!needsPermission) return null;
  return (
    <div className="notice">
      Device names are hidden until you allow camera and microphone access.
      <button className="btn btn-small" onClick={() => void local.retry()}>
        Allow access
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- profile

function ProfilePanel({ local, session }: { local: LocalMedia; session?: MeetingSession }) {
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const [draft, setDraft] = useState(s.displayName);
  return (
    <div className="panel">
      <section className="panel-section">
        <h3>Name</h3>
        {session ? (
          <div className="row-with-button">
            <input value={draft} maxLength={40} onChange={(e) => setDraft(e.target.value)} aria-label="Display name" data-testid="settings-name" />
            <button
              className="btn"
              disabled={!draft.trim() || draft.trim() === s.displayName}
              onClick={() => {
                session.setName(draft);
                updateSettings({ displayName: draft.trim() });
                toast('Name updated', 'success');
              }}
            >
              Save
            </button>
          </div>
        ) : (
          <input
            value={s.displayName}
            onChange={(e) => updateSettings({ displayName: e.target.value.slice(0, 40) })}
            placeholder="What should people call you?"
            maxLength={40}
            aria-label="Display name"
            data-testid="settings-name"
          />
        )}
      </section>
      <section className="panel-section">
        <h3>Picture</h3>
        <PfpEditor name={s.displayName} track={local.rawCam} />
      </section>
      <section className="panel-section">
        <h3>Reset</h3>
        <p className="muted small">Puts every setting back to its default. Your name, picture and found secrets are kept.</p>
        <button
          className="btn btn-ghost"
          onClick={() => {
            resetSettings();
            toast('Settings reset', 'success');
          }}
        >
          <RotateCcw size={16} /> Reset all settings
        </button>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- appearance

function AppearancePanel() {
  const s = useSettings();
  return (
    <div className="panel">
      <section className="panel-section">
        <h3>Theme</h3>
        <div className="theme-grid" data-testid="theme-grid">
          {THEMES.map((t) => {
            const locked = !!t.secret && !s.eggs.includes(t.secret);
            return (
              <button
                key={t.id}
                className={`theme-opt ${s.theme === t.id ? 'sel' : ''} ${locked ? 'locked' : ''}`}
                onClick={() => !locked && updateSettings({ theme: t.id })}
                disabled={locked}
                title={locked ? 'Secret theme. Find its easter egg to unlock.' : t.label}
                data-testid={`theme-${t.id}`}
              >
                <span className="theme-swatch" style={{ background: t.colors[0] }}>
                  <i style={{ background: `linear-gradient(135deg, ${t.colors[1]}, ${t.colors[2]})` }} />
                  {locked && <Lock size={14} />}
                  {s.theme === t.id && <Check size={14} />}
                </span>
                <span>{locked ? '???' : t.label}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel-section">
        <h3>Motion</h3>
        <Toggle label="Reduce motion" hint="Turns off animations and screen effects" checked={s.reduceMotion} onChange={(v) => updateSettings({ reduceMotion: v })} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- audio

function AudioPanel({ local }: { local: LocalMedia }) {
  useEmitter(local);
  const s = useSettings();
  const [busy, setBusy] = useState(false);
  const mics = local.devices.filter((d) => d.kind === 'audioinput');
  const speakers = local.devices.filter((d) => d.kind === 'audiooutput');

  useEffect(() => {
    audioLevels.watch(METER_ID, local.micMonitorStream);
    return () => audioLevels.unwatch(METER_ID);
  }, [local.micMonitorStream]);

  const setProcessing = async (patch: Partial<Settings>) => {
    updateSettings(patch);
    setBusy(true);
    await local.reapplyAudioProcessing();
    setBusy(false);
  };

  return (
    <div className="panel">
      <PermissionNotice local={local} />
      <section className="panel-section">
        <h3>Microphone</h3>
        <DeviceSelect
          label="Microphone"
          icon={<Mic size={16} />}
          devices={mics}
          value={local.micId}
          onChange={(id) => void local.switchMic(id)}
          emptyText="No microphone found"
          testId="mic-select"
        />
        {local.micError ? <p className="error-text">{local.micError.message}</p> : <LevelMeter id={METER_ID} bars={22} />}
        <Toggle label="Noise suppression" checked={s.noiseSuppression} onChange={(v) => void setProcessing({ noiseSuppression: v })} />
        <Toggle
          label="Echo cancellation"
          hint="Keep on unless you wear headphones"
          checked={s.echoCancellation}
          onChange={(v) => void setProcessing({ echoCancellation: v })}
        />
        <Toggle label="Automatic gain control" checked={s.autoGainControl} onChange={(v) => void setProcessing({ autoGainControl: v })} />
        {busy && <p className="muted small">Applying…</p>}
      </section>
      <section className="panel-section">
        <h3>Speakers</h3>
        {supportsSinkSelection() ? (
          <div className="row-with-button">
            <DeviceSelect
              label="Output"
              icon={<Speaker size={16} />}
              devices={speakers}
              value={s.speakerId}
              onChange={(id) => {
                updateSettings({ speakerId: id });
                void setSoundsSink(id);
              }}
              emptyText="Default speakers"
              testId="speaker-select"
            />
            <button className="btn btn-ghost" onClick={() => sounds.test()}>
              <Volume2 size={16} /> Test
            </button>
          </div>
        ) : (
          <p className="muted small">This browser uses the system default speakers (output selection needs Chrome or Edge).</p>
        )}
      </section>
      <section className="panel-section">
        <h3>Sounds</h3>
        <Toggle label="Join, leave and message sounds" checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
        <label className="field range-field">
          <span>Volume · {Math.round(s.soundVolume * 100)}%</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={s.soundVolume}
            onChange={(e) => updateSettings({ soundVolume: Number(e.target.value) })}
            onPointerUp={() => sounds.join()}
          />
        </label>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- video

function VideoPanel({ local }: { local: LocalMedia }) {
  useEmitter(local);
  const s = useSettings();
  const cams = local.devices.filter((d) => d.kind === 'videoinput');
  const codecs = useMemo(() => supportedCodecs(), []);
  const codecLabel: Record<CodecPref, string> = {
    auto: 'Automatic (recommended)',
    vp8: 'VP8 (most compatible)',
    vp9: 'VP9 (sharper, more CPU)',
    h264: 'H.264 (hardware accelerated)',
    av1: 'AV1 (best quality per bit, heavy)',
  };
  return (
    <div className="panel">
      <PermissionNotice local={local} />
      <section className="panel-section">
        <h3>Camera</h3>
        <div className="preview-box">
          {local.camStream ? (
            <VideoView stream={local.camStream} mirror={s.mirrorSelf} />
          ) : (
            <div className="preview-empty">
              {local.camError?.message ?? (local.camStarting ? 'Starting camera…' : 'Camera is off')}
              {!local.camStarting && (
                <button className="btn btn-small" onClick={() => void local.setCamOn(true)}>
                  Turn on camera
                </button>
              )}
            </div>
          )}
        </div>
        <DeviceSelect
          label="Camera"
          icon={<Video size={16} />}
          devices={cams}
          value={local.camId}
          onChange={(id) => void local.switchCam(id)}
          emptyText="No camera found"
          testId="cam-select"
        />
        <Toggle label="Mirror my video" hint="Only changes how you see yourself" checked={s.mirrorSelf} onChange={(v) => updateSettings({ mirrorSelf: v })} />
      </section>
      <section className="panel-section">
        <h3>Quality</h3>
        <Select<VideoQuality>
          label="Send quality"
          value={s.videoQuality}
          onChange={(v) => updateSettings({ videoQuality: v })}
          options={(Object.keys(QUALITY) as VideoQuality[]).map((k) => ({ value: k, label: QUALITY[k].label }))}
          hint="Higher needs a faster upload. In bigger calls your bandwidth is split between people automatically."
          testId="quality-select"
        />
      </section>
      <section className="panel-section">
        <h3>Advanced</h3>
        <Select<CodecPref>
          label="Video codec"
          value={codecs.includes(s.codec) ? s.codec : 'auto'}
          onChange={(v) => updateSettings({ codec: v })}
          options={codecs.map((c) => ({ value: c, label: codecLabel[c] }))}
          hint="Applies to new connections. Falls back automatically if someone can't use it."
        />
        <Toggle
          label="Low latency mode"
          hint="Smallest possible receive buffer. Turn off if video stutters on a bad network."
          checked={s.lowLatency}
          onChange={(v) => updateSettings({ lowLatency: v })}
          testId="low-latency"
        />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- backgrounds & effects

function EffectsPanel({ local }: { local: LocalMedia }) {
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [customs, setCustoms] = useState(getCustomBgs);
  const thumbs = useMemo(() => BG_PRESETS.map((p) => ({ id: `preset:${p.id}`, label: p.label, src: presetThumb(p) })), []);
  const rawStream = useMemo(() => (local.rawCam ? new MediaStream([local.rawCam]) : null), [local.rawCam]);

  const pickBg = (bgEffect: Settings['bgEffect'], bgImage?: string) => updateSettings({ bgEffect, ...(bgImage ? { bgImage } : {}) });

  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast('Pick an image file', 'error');
      return;
    }
    try {
      const id = await addCustomBg(file);
      setCustoms(getCustomBgs());
      pickBg('image', id);
    } catch {
      toast('Could not use that image', 'error');
    }
  };

  const isSel = (effect: Settings['bgEffect'], image?: string) => s.bgEffect === effect && (!image || s.bgImage === image);

  return (
    <div className="panel">
      <section className="panel-section">
        <div className="preview-box">
          {local.camStream ? (
            <VideoView stream={local.camStream} mirror={s.mirrorSelf} />
          ) : (
            <div className="preview-empty">
              Turn your camera on to preview effects.
              {!local.camStarting && (
                <button className="btn btn-small" onClick={() => void local.setCamOn(true)}>
                  Turn on camera
                </button>
              )}
            </div>
          )}
        </div>
        {local.effectsError && <p className="error-text">{local.effectsError}</p>}
      </section>
      <section className="panel-section">
        <h3>Background</h3>
        <div className="bg-grid" data-testid="bg-grid">
          <button className={`bg-opt ${isSel('none') ? 'sel' : ''}`} onClick={() => pickBg('none')} data-testid="bg-none">
            <X size={20} />
            <span>None</span>
          </button>
          <button className={`bg-opt ${isSel('blur-light') ? 'sel' : ''}`} onClick={() => pickBg('blur-light')} data-testid="bg-blur-light">
            <span className="blur-icon light" />
            <span>Slight blur</span>
          </button>
          <button className={`bg-opt ${isSel('blur') ? 'sel' : ''}`} onClick={() => pickBg('blur')} data-testid="bg-blur">
            <span className="blur-icon" />
            <span>Blur</span>
          </button>
          {thumbs.map((t) => (
            <button
              key={t.id}
              className={`bg-opt img ${isSel('image', t.id) ? 'sel' : ''}`}
              onClick={() => pickBg('image', t.id)}
              style={{ backgroundImage: `url(${t.src})` }}
              title={t.label}
              data-testid={`bg-${t.id}`}
            >
              <span className="bg-label">{t.label}</span>
            </button>
          ))}
          {customs.map((url, i) => (
            <div key={i} className={`bg-opt img ${isSel('image', `custom:${i}`) ? 'sel' : ''}`} style={{ backgroundImage: `url(${url})` }}>
              <button className="bg-hit" onClick={() => pickBg('image', `custom:${i}`)} aria-label={`Custom background ${i + 1}`} />
              <button
                className="bg-del"
                onClick={() => {
                  removeCustomBg(i);
                  setCustoms(getCustomBgs());
                  if (s.bgImage.startsWith('custom:')) pickBg(s.bgEffect === 'image' ? 'none' : s.bgEffect, 'preset:aurora');
                }}
                aria-label="Delete background"
                title="Delete"
              >
                <X size={12} />
              </button>
            </div>
          ))}
          {customs.length < MAX_CUSTOM && (
            <button className="bg-opt add" onClick={() => fileInput.current?.click()} data-testid="bg-upload">
              <ImagePlus size={20} />
              <span>Upload</span>
            </button>
          )}
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} data-testid="bg-file" />
        </div>
        <p className="muted small">Runs entirely on your device. Your real background is never sent while an effect is loading.</p>
      </section>
      <section className="panel-section">
        <h3>Face stickers</h3>
        <div className="sticker-grid" data-testid="sticker-grid">
          {STICKERS.map((st) => (
            <button key={st.id} className={`sticker-opt ${s.sticker === st.id ? 'sel' : ''}`} onClick={() => updateSettings({ sticker: st.id })} data-testid={`sticker-${st.id}`}>
              <span>{st.emoji}</span>
              {st.label}
            </button>
          ))}
        </div>
        <p className="muted small">Follows your face. Everyone sees it.</p>
      </section>
      <section className="panel-section">
        <h3>Filters</h3>
        <div className="filter-grid" data-testid="filter-grid">
          {(Object.keys(FILTERS) as FilterId[]).map((f) => (
            <button key={f} className={`filter-opt ${s.filter === f ? 'sel' : ''}`} onClick={() => updateSettings({ filter: f })} data-testid={`filter-${f}`}>
              <div className="filter-thumb" style={{ filter: cssFilterFor({ filter: f, lowLight: false }) }}>
                {rawStream ? <VideoView stream={rawStream} mirror={s.mirrorSelf} /> : <div className="filter-fallback" />}
                {f === 'pixel' && <div className="pixel-grid" />}
              </div>
              <span>{FILTERS[f].label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel-section">
        <h3>Camera helpers</h3>
        <Toggle
          label="Auto-framing"
          hint="Zooms in and follows you so you stay centered"
          checked={s.autoFrame}
          onChange={(v) => updateSettings({ autoFrame: v })}
          testId="auto-frame"
        />
        <Toggle label="Low-light boost" hint="Brightens dim rooms" checked={s.lowLightBoost} onChange={(v) => updateSettings({ lowLightBoost: v })} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- calls

const CAPTION_LANGS: [string, string][] = [
  ['en-US', 'English (US)'],
  ['en-GB', 'English (UK)'],
  ['es-ES', 'Español'],
  ['fr-FR', 'Français'],
  ['de-DE', 'Deutsch'],
  ['it-IT', 'Italiano'],
  ['pt-BR', 'Português (BR)'],
  ['nl-NL', 'Nederlands'],
  ['pl-PL', 'Polski'],
  ['tr-TR', 'Türkçe'],
  ['ru-RU', 'Русский'],
  ['hi-IN', 'हिन्दी'],
  ['ja-JP', '日本語'],
  ['ko-KR', '한국어'],
  ['zh-CN', '中文'],
];

function ConnectionLine({ session }: { session: MeetingSession }) {
  const snap = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <p className="muted small">
      Signaling: {snap.transport || 'starting'} ({snap.signal}
      {snap.signalDetail ? `, ${snap.signalDetail}` : ''}). Video and audio go directly between people.
    </p>
  );
}

function CallsPanel({ session }: { session?: MeetingSession }) {
  const s = useSettings();
  return (
    <div className="panel">
      <section className="panel-section">
        <h3>When you join</h3>
        <Toggle label="Join with microphone muted" checked={s.joinMuted} onChange={(v) => updateSettings({ joinMuted: v })} />
        <Toggle label="Join with camera off" checked={s.joinCameraOff} onChange={(v) => updateSettings({ joinCameraOff: v })} />
      </section>
      <section className="panel-section">
        <h3>During calls</h3>
        <Toggle label="Push to talk" hint="While muted, hold Space to talk" checked={s.pushToTalk} onChange={(v) => updateSettings({ pushToTalk: v })} />
        <Toggle label="Hide my own video" hint="Others still see you" checked={s.hideSelfView} onChange={(v) => updateSettings({ hideSelfView: v })} />
        <Toggle
          label="Mini player when I switch tabs"
          hint="A small floating window with the call and your controls (Chrome and Edge)"
          checked={s.autoMiniPlayer}
          onChange={(v) => updateSettings({ autoMiniPlayer: v })}
        />
        <Toggle
          label="Filter swear words"
          hint="Shows f*** instead in chat, captions and polls (only on your screen)"
          checked={s.censorSwears}
          onChange={(v) => updateSettings({ censorSwears: v })}
          testId="censor-toggle"
        />
      </section>
      <section className="panel-section">
        <h3>Captions</h3>
        <Toggle
          label="Share my captions"
          hint={
            captionsSupported()
              ? 'When someone turns on captions, your browser transcribes your mic (Chrome and Edge use their speech service for this)'
              : 'Live captions need Chrome or Edge'
          }
          checked={s.shareCaptions}
          onChange={(v) => updateSettings({ shareCaptions: v })}
        />
        <Select<string>
          label="Language you speak"
          value={s.captionsLang}
          onChange={(v) => updateSettings({ captionsLang: v })}
          options={[{ value: '', label: `Browser default (${navigator.language})` }, ...CAPTION_LANGS.map(([value, label]) => ({ value, label }))]}
        />
      </section>
      <section className="panel-section">
        <h3>Advanced</h3>
        <Toggle
          label="Connection stats on tiles"
          hint="Resolution, frame rate, bitrate, delay and codec for each person"
          checked={s.showConnectionDetails}
          onChange={(v) => updateSettings({ showConnectionDetails: v })}
          testId="stats-toggle"
        />
        {session && <ConnectionLine session={session} />}
      </section>
      <section className="panel-section">
        <h3>Keyboard shortcuts</h3>
        <ShortcutList />
      </section>
    </div>
  );
}

export function ShortcutList() {
  return (
    <ul className="shortcuts" data-testid="shortcuts">
      <li>
        <kbd>Ctrl</kbd>+<kbd>D</kbd> Mute / unmute
      </li>
      <li>
        <kbd>Ctrl</kbd>+<kbd>E</kbd> Camera on / off
      </li>
      <li>
        <kbd>Space</kbd> (hold, while muted) Push to talk
      </li>
      <li>
        <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> Raise / lower hand
      </li>
      <li>
        <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> Open chat
      </li>
      <li>
        <kbd>1</kbd>-<kbd>9</kbd> Soundboard pads (while the soundboard is open)
      </li>
      <li>
        <kbd>?</kbd> Show this list in a call
      </li>
      <li>
        <kbd>Esc</kbd> Close menus and windows
      </li>
    </ul>
  );
}

// ---------------------------------------------------------------- secrets

function SecretsPanel() {
  const s = useSettings();
  const found = EGGS.filter((e) => s.eggs.includes(e.id)).length;
  return (
    <div className="panel">
      <section className="panel-section">
        <h3>
          Found {found} of {EGGS.length}
        </h3>
        <div className="egg-progress">
          <span style={{ width: `${(found / EGGS.length) * 100}%` }} />
        </div>
        <ul className="egg-list">
          {EGGS.map((e) => {
            const got = s.eggs.includes(e.id);
            return (
              <li key={e.id} className={got ? 'got' : ''}>
                <span className="egg-icon">{got ? '🥚' : '❔'}</span>
                <div>
                  <b>{got ? e.name : 'Undiscovered'}</b>
                  <p>{got ? e.found : e.hint}</p>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
