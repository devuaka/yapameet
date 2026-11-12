import { useEffect, useRef, useState } from 'react';
import { Copy, Share2, X } from 'lucide-react';
import QRCode from 'qrcode';
import { meetingUrl } from '../lib/meetingCode';
import { copyText, useToast } from './Toast';

/** QR code for a link, rendered locally (no third-party image service). */
export function QrCode({ text, size = 168 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(text, { width: size * 2, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0b0c15', light: '#ffffff' } })
      .then((url) => alive && setSrc(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [text, size]);
  return src ? <img className="qr" src={src} alt="QR code for the meeting link" width={size} height={size} data-testid="qr" /> : <div className="qr qr-empty" style={{ width: size, height: size }} />;
}

/** Popover with everything needed to invite someone. */
export function MeetingInfo({ code, people, onClose }: { code: string; people: number; onClose: () => void }) {
  const toast = useToast();
  const box = useRef<HTMLDivElement>(null);
  const link = meetingUrl(code);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement;
      if (!box.current?.contains(t) && !t.closest('[data-testid="copy-link"]')) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div className="meeting-info" ref={box} role="dialog" aria-label="Meeting info" data-testid="meeting-info">
      <div className="mi-head">
        <b>Meeting info</b>
        <button className="icon-btn ghost" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <div className="mi-body">
        <QrCode text={link} />
        <div className="mi-text">
          <span className="mi-code mono">{code}</span>
          <span className="muted small">Scan with a phone camera to join, or share the link.</span>
          <span className="muted small">
            {people} {people === 1 ? 'person' : 'people'} in the call
          </span>
        </div>
      </div>
      <div className="link-box">
        <span className="link-text">{link}</span>
        <button className="icon-btn" onClick={async () => toast((await copyText(link)) ? 'Link copied' : 'Could not copy', 'success')} aria-label="Copy link" title="Copy link" data-testid="mi-copy">
          <Copy size={16} />
        </button>
        {'share' in navigator && (
          <button className="icon-btn" onClick={() => void navigator.share({ title: 'Join my Yapameet call', url: link }).catch(() => {})} aria-label="Share" title="Share">
            <Share2 size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
