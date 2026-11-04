import { forwardRef, useEffect, useImperativeHandle, useRef, useSyncExternalStore } from 'react';
import { audioLevels } from '../lib/audioLevel';

type SinkableMedia = HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> };

export const supportsSinkSelection = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

/** <video> bound to a MediaStream. Always muted: audio plays through <RemoteAudio>. */
export const VideoView = forwardRef<
  HTMLVideoElement,
  { stream: MediaStream | null; mirror?: boolean; fit?: 'cover' | 'contain'; className?: string; testId?: string }
>(function VideoView({ stream, mirror, fit = 'cover', className, testId }, ref) {
  const el = useRef<HTMLVideoElement>(null);
  useImperativeHandle(ref, () => el.current!, []);
  useEffect(() => {
    const v = el.current;
    if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().catch(() => {});
  }, [stream]);
  useEffect(
    () => () => {
      if (el.current) el.current.srcObject = null;
    },
    [],
  );
  return (
    <video
      ref={el}
      className={`video ${mirror ? 'mirror' : ''} ${className ?? ''}`}
      style={{ objectFit: fit }}
      autoPlay
      playsInline
      muted
      data-testid={testId}
    />
  );
});

/** Hidden audio element for a remote stream, routed to the chosen speaker. */
export function RemoteAudio({
  stream,
  sinkId,
  onBlocked,
  testId,
}: {
  stream: MediaStream | null;
  sinkId: string;
  onBlocked?: () => void;
  testId?: string;
}) {
  const el = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const a = el.current;
    if (!a) return;
    a.srcObject = stream;
    if (stream) {
      a.play().catch((err) => {
        if ((err as DOMException).name === 'NotAllowedError') onBlocked?.();
      });
    }
  }, [stream, onBlocked]);
  useEffect(() => {
    const a = el.current as SinkableMedia | null;
    if (a?.setSinkId) a.setSinkId(sinkId || '').catch(() => {});
  }, [sinkId, stream]);
  useEffect(
    () => () => {
      if (el.current) el.current.srcObject = null;
    },
    [],
  );
  return <audio ref={el} autoPlay data-testid={testId} />;
}

export function useSpeaking(id: string): boolean {
  return useSyncExternalStore(
    (fn) => audioLevels.subscribe(id, fn),
    () => audioLevels.speaking(id),
  );
}

export function useAudioLevel(id: string): number {
  return useSyncExternalStore(
    (fn) => audioLevels.subscribe(id, fn),
    () => Math.round(audioLevels.level(id) * 20) / 20,
  );
}

/** Small bar meter for a watched stream id. */
export function LevelMeter({ id, bars = 8 }: { id: string; bars?: number }) {
  const level = useAudioLevel(id);
  const lit = Math.round(level * bars * 1.4);
  return (
    <div className="meter" aria-label="Microphone level">
      {Array.from({ length: bars }, (_, i) => (
        <span key={i} className={i < lit ? 'on' : ''} />
      ))}
    </div>
  );
}
