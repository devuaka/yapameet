import { useEffect, useState } from 'react';
import { Mic, Speaker, Video, Volume2 } from 'lucide-react';
import type { LocalMedia } from '../rtc/LocalMedia';
import { useEmitter } from '../lib/hooks';
import { updateSettings, useSettings } from '../lib/settings';
import { setSoundsSink, sounds } from '../lib/sounds';
import { audioLevels } from '../lib/audioLevel';
import { DeviceSelect, Toggle } from './controls';
import { LevelMeter, VideoView, supportsSinkSelection } from './media';

const METER_ID = '__device-panel-mic';

/** Device pickers + previews. Used on the Settings page and in the in-call settings dialog. */
export function DevicePanel({ local, section }: { local: LocalMedia; section: 'audio' | 'video' | 'all' }) {
  useEmitter(local);
  const s = useSettings();
  const mics = local.devices.filter((d) => d.kind === 'audioinput');
  const cams = local.devices.filter((d) => d.kind === 'videoinput');
  const speakers = local.devices.filter((d) => d.kind === 'audiooutput');
  const needsPermission = local.devices.length > 0 && local.devices.every((d) => !d.label);

  useEffect(() => {
    audioLevels.watch(METER_ID, local.micStream);
    return () => audioLevels.unwatch(METER_ID);
  }, [local.micStream]);

  const showAudio = section !== 'video';
  const showVideo = section !== 'audio';
  const [reapplying, setReapplying] = useState(false);

  const setProcessing = async (patch: Partial<typeof s>) => {
    updateSettings(patch);
    setReapplying(true);
    await local.reapplyAudioProcessing();
    setReapplying(false);
  };

  return (
    <div className="device-panel">
      {needsPermission && (
        <div className="notice">
          Device names are hidden until you allow camera and microphone access.
          <button className="btn btn-small" onClick={() => void local.retry()}>
            Allow access
          </button>
        </div>
      )}
      {showAudio && (
        <section className="panel-section">
          <h3>Audio</h3>
          <DeviceSelect
            label="Microphone"
            icon={<Mic size={16} />}
            devices={mics}
            value={local.micId}
            onChange={(id) => void local.switchMic(id)}
            emptyText="No microphone found"
            testId="mic-select"
          />
          {local.micError ? <p className="error-text">{local.micError.message}</p> : <LevelMeter id={METER_ID} bars={14} />}
          {supportsSinkSelection() ? (
            <div className="row-with-button">
              <DeviceSelect
                label="Speakers"
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
          <Toggle
            label="Noise suppression"
            checked={s.noiseSuppression}
            onChange={(v) => void setProcessing({ noiseSuppression: v })}
          />
          <Toggle
            label="Echo cancellation"
            hint="Keep on unless you use headphones and want raw audio"
            checked={s.echoCancellation}
            onChange={(v) => void setProcessing({ echoCancellation: v })}
          />
          <Toggle
            label="Automatic gain control"
            checked={s.autoGainControl}
            onChange={(v) => void setProcessing({ autoGainControl: v })}
          />
          {reapplying && <p className="muted small">Applying…</p>}
        </section>
      )}
      {showVideo && (
        <section className="panel-section">
          <h3>Video</h3>
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
          <Toggle label="Mirror my video" hint="Only affects how you see yourself" checked={s.mirrorSelf} onChange={(v) => updateSettings({ mirrorSelf: v })} />
        </section>
      )}
    </div>
  );
}
