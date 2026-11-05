import { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, Smile, Trash2 } from 'lucide-react';
import { PFP_COLORS, PFP_EMOJIS, pfpFromEmoji, pfpFromFile, pfpFromTrack, setPfp, usePfp } from '../lib/pfp';
import { useSettings } from '../lib/settings';
import { Avatar } from './controls';
import { VideoView } from './media';
import { useToast } from './Toast';

/**
 * Pick a profile picture: upload, take one with the camera, or build an emoji avatar.
 * `track` reuses a camera that's already open; otherwise the camera is opened briefly.
 */
export function PfpEditor({ name, track }: { name: string; track?: MediaStreamTrack | null }) {
  const pfp = usePfp();
  const s = useSettings();
  const toast = useToast();
  const file = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'none' | 'emoji' | 'camera'>('none');
  const [emoji, setEmoji] = useState(PFP_EMOJIS[0]);
  const [colors, setColors] = useState(PFP_COLORS[0]);
  const [camStream, setCamStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const ownTrack = useRef<MediaStreamTrack | null>(null);

  const stopOwnCam = () => {
    ownTrack.current?.stop();
    ownTrack.current = null;
  };
  useEffect(() => () => stopOwnCam(), []);

  const openCamera = async () => {
    setMode('camera');
    if (track && track.readyState === 'live') {
      setCamStream(new MediaStream([track]));
      return;
    }
    try {
      const st = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 640 } } });
      ownTrack.current = st.getVideoTracks()[0];
      setCamStream(st);
    } catch {
      toast('Camera is blocked or unavailable', 'error');
      setMode('none');
    }
  };

  const snap = async () => {
    const t = camStream?.getVideoTracks()[0];
    if (!t) return;
    setBusy(true);
    const url = await pfpFromTrack(t, s.mirrorSelf);
    setBusy(false);
    if (url) {
      setPfp(url);
      toast('Profile picture updated', 'success');
    }
    stopOwnCam();
    setCamStream(null);
    setMode('none');
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      setPfp(await pfpFromFile(f));
      toast('Profile picture updated', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
    if (file.current) file.current.value = '';
  };

  return (
    <div className="pfp-editor" data-testid="pfp-editor">
      <div className="pfp-current">
        {mode === 'emoji' ? (
          <img className="avatar avatar-img" src={pfpFromEmoji(emoji, colors)} alt="Preview" style={{ width: 96, height: 96 }} />
        ) : mode === 'camera' && camStream ? (
          <div className="pfp-cam">
            <VideoView stream={camStream} mirror={s.mirrorSelf} />
          </div>
        ) : (
          <Avatar name={name || 'You'} size={96} src={pfp} />
        )}
        <div className="pfp-actions">
          <button className="btn btn-small" onClick={() => file.current?.click()} data-testid="pfp-upload">
            <ImagePlus size={15} /> Upload
          </button>
          {mode === 'camera' ? (
            <button className="btn btn-small btn-primary" onClick={() => void snap()} disabled={busy || !camStream} data-testid="pfp-snap">
              <Camera size={15} /> Take it
            </button>
          ) : (
            <button className="btn btn-small btn-ghost" onClick={() => void openCamera()} data-testid="pfp-camera">
              <Camera size={15} /> Take photo
            </button>
          )}
          <button className={`btn btn-small btn-ghost ${mode === 'emoji' ? 'active' : ''}`} onClick={() => setMode(mode === 'emoji' ? 'none' : 'emoji')} data-testid="pfp-emoji-mode">
            <Smile size={15} /> Emoji
          </button>
          {pfp && mode === 'none' && (
            <button className="btn btn-small btn-ghost" onClick={() => setPfp(null)} title="Use initials instead" data-testid="pfp-remove">
              <Trash2 size={15} /> Remove
            </button>
          )}
        </div>
      </div>
      {mode === 'emoji' && (
        <div className="pfp-emoji">
          <div className="pfp-emoji-grid">
            {PFP_EMOJIS.map((e) => (
              <button key={e} className={e === emoji ? 'sel' : ''} onClick={() => setEmoji(e)} aria-label={`Emoji ${e}`}>
                {e}
              </button>
            ))}
          </div>
          <div className="pfp-colors">
            {PFP_COLORS.map((c) => (
              <button
                key={c.join()}
                className={c === colors ? 'sel' : ''}
                style={{ background: `linear-gradient(135deg, ${c[0]}, ${c[1]})` }}
                onClick={() => setColors(c)}
                aria-label="Background color"
              />
            ))}
          </div>
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              setPfp(pfpFromEmoji(emoji, colors));
              setMode('none');
              toast('Profile picture updated', 'success');
            }}
            data-testid="pfp-emoji-save"
          >
            Use this
          </button>
        </div>
      )}
      <input ref={file} type="file" accept="image/*" hidden onChange={(e) => void upload(e.target.files?.[0])} data-testid="pfp-file" />
      <p className="muted small">Shown when your camera is off, in People and next to your chat messages. Shared directly with people in your calls.</p>
    </div>
  );
}
