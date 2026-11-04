import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ImagePlus, Lock, Mic, Speaker, Video, Volume2, X } from 'lucide-react';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useEmitter } from '../lib/hooks';
import {
  QUALITY,
  updateSettings,
  useSettings,
  type CodecPref,
  type FilterId,
  type LayoutPref,
  type Settings,
  type VideoQuality,
} from '../lib/settings';
import { setSoundsSink, sounds } from '../lib/sounds';
import { audioLevels } from '../lib/audioLevel';
import { BG_PRESETS, MAX_CUSTOM, addCustomBg, getCustomBgs, presetThumb, removeCustomBg } from '../lib/backgrounds';
import { FILTERS, cssFilterFor } from '../rtc/effects';
import { supportedCodecs } from '../rtc/tuning';
import { EGGS, THEMES } from '../lib/themes';
import { DeviceSelect, Toggle } from './controls';
import { LevelMeter, VideoView, supportsSinkSelection } from './media';
import { useToast } from './Toast';

const METER_ID = '__settings-mic';

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

// ---------------------------------------------------------------- audio

export function AudioPanel({ local }: { local: LocalMedia }) {
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
    <div className="device-panel">
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
        {local.micError ? <p className="error-text">{local.micError.message}</p> : <LevelMeter id={METER_ID} bars={18} />}
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
            <button className="btn btn-small btn-ghost" onClick={() => sounds.test()}>
              <Volume2 size={16} /> Test
            </button>
          </div>
        ) : (
          <p className="muted small">This browser uses the system default speakers (output selection needs Chrome or Edge).</p>
        )}
        <Toggle label="Join, leave & message sounds" checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
        <label className="field range-field">
          <span>Sound effects volume · {Math.round(s.soundVolume * 100)}%</span>
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

export function VideoPanel({ local }: { local: LocalMedia }) {
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
    <div className="device-panel">
      <PermissionNotice local={local} />
      <section className="panel-section">
        <h3>Camera</h3>
        <DeviceSelect
          label="Camera"
          icon={<Video size={16} />}
          devices={cams}
          value={local.camId}
          onChange={(id) => void local.switchCam(id)}
          emptyText="No camera found"
          testId="cam-select"
        />
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
        <Toggle label="Mirror my video" hint="Only changes how you see yourself" checked={s.mirrorSelf} onChange={(v) => updateSettings({ mirrorSelf: v })} />
      </section>
      <section className="panel-section">
        <h3>Quality & latency</h3>
        <Select<VideoQuality>
          label="Send quality"
          value={s.videoQuality}
          onChange={(v) => updateSettings({ videoQuality: v })}
          options={(Object.keys(QUALITY) as VideoQuality[]).map((k) => ({ value: k, label: QUALITY[k].label }))}
          hint="Higher needs a faster upload. In bigger calls Yapameet automatically splits your bandwidth between people."
          testId="quality-select"
        />
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

// ---------------------------------------------------------------- effects

export function EffectsPanel({ local }: { local: LocalMedia }) {
  useEmitter(local);
  const s = useSettings();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [customs, setCustoms] = useState(getCustomBgs);
  const thumbs = useMemo(() => BG_PRESETS.map((p) => ({ id: `preset:${p.id}`, label: p.label, src: presetThumb(p) })), []);
  const rawStream = useMemo(() => (local.rawCam ? new MediaStream([local.rawCam]) : null), [local.rawCam]);
  const previewFilter = cssFilterFor({ filter: s.filter, lowLight: s.lowLightBoost });

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
    <div className="device-panel">
      <section className="panel-section">
        <h3>Preview</h3>
        <div className="preview-box">
          {local.camStream ? (
            <VideoView stream={local.camStream} mirror={s.mirrorSelf} />
          ) : (
            <div className="preview-empty">Turn your camera on to preview effects.</div>
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
                  const next = getCustomBgs();
                  setCustoms(next);
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
        <Toggle
          label="Low-light boost"
          hint="Brightens dim rooms"
          checked={s.lowLightBoost}
          onChange={(v) => updateSettings({ lowLightBoost: v })}
        />
        {previewFilter !== 'none' && <p className="muted small">Filters are applied to the video everyone sees.</p>}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- appearance

export function AppearancePanel() {
  const s = useSettings();
  return (
    <div className="device-panel">
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
                <span
                  className="theme-swatch"
                  style={{ background: `linear-gradient(135deg, ${t.colors[1]}, ${t.colors[2]})`, boxShadow: `inset 0 0 0 6px ${t.colors[0]}` }}
                >
                  {locked && <Lock size={16} />}
                  {s.theme === t.id && <Check size={16} />}
                </span>
                <span>{locked ? '???' : t.label}</span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel-section">
        <h3>Interface</h3>
        <Toggle label="Reduce motion" hint="Turns off animations and screen effects" checked={s.reduceMotion} onChange={(v) => updateSettings({ reduceMotion: v })} />
        <Toggle label="Show clock in calls" checked={s.showClock} onChange={(v) => updateSettings({ showClock: v })} />
        <Toggle label="Compact tiles" hint="Smaller gaps and corners, more video" checked={s.compactTiles} onChange={(v) => updateSettings({ compactTiles: v })} />
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- meeting

export function MeetingPanel() {
  const s = useSettings();
  return (
    <div className="device-panel">
      <section className="panel-section">
        <h3>Layout</h3>
        <Select<LayoutPref>
          label="Video layout"
          value={s.layout}
          onChange={(v) => updateSettings({ layout: v })}
          options={[
            { value: 'auto', label: 'Auto (smart)' },
            { value: 'grid', label: 'Grid (everyone the same size)' },
            { value: 'speaker', label: 'Speaker (whoever talks is big)' },
          ]}
          testId="layout-select"
        />
        <Toggle label="Hide my own video" hint="Others still see you" checked={s.hideSelfView} onChange={(v) => updateSettings({ hideSelfView: v })} />
        <Toggle label="Floating reactions" checked={s.reactionsFloat} onChange={(v) => updateSettings({ reactionsFloat: v })} />
        <Toggle
          label="Show connection stats on tiles"
          hint="Resolution, fps, bitrate, delay and codec"
          checked={s.showConnectionDetails}
          onChange={(v) => updateSettings({ showConnectionDetails: v })}
        />
      </section>
      <section className="panel-section">
        <h3>Microphone behaviour</h3>
        <Toggle label="Join with microphone muted" checked={s.joinMuted} onChange={(v) => updateSettings({ joinMuted: v })} />
        <Toggle label="Join with camera off" checked={s.joinCameraOff} onChange={(v) => updateSettings({ joinCameraOff: v })} />
        <Toggle label="Push to talk" hint="While muted, hold Space to talk" checked={s.pushToTalk} onChange={(v) => updateSettings({ pushToTalk: v })} />
        <Toggle label="Warn me when I talk while muted" checked={s.mutedWarning} onChange={(v) => updateSettings({ mutedWarning: v })} />
      </section>
      <section className="panel-section">
        <h3>Keyboard shortcuts</h3>
        <ul className="shortcuts">
          <li><kbd>Ctrl</kbd>+<kbd>D</kbd> Mute / unmute</li>
          <li><kbd>Ctrl</kbd>+<kbd>E</kbd> Camera on / off</li>
          <li><kbd>Space</kbd> (hold, while muted) Push to talk</li>
          <li><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>H</kbd> Raise / lower hand</li>
          <li><kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>C</kbd> Open chat</li>
          <li><kbd>Esc</kbd> Close panels</li>
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- secrets

export function SecretsPanel() {
  const s = useSettings();
  const found = EGGS.filter((e) => s.eggs.includes(e.id)).length;
  return (
    <div className="device-panel">
      <section className="panel-section">
        <h3>
          Secrets found · {found}/{EGGS.length}
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
