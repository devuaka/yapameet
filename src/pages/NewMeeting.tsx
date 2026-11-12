import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, RefreshCw, Share2, Video } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { copyText, useToast } from '../components/Toast';
import { generateMeetingCode, meetingUrl } from '../lib/meetingCode';
import { QrCode } from '../components/MeetingInfo';
import { updateSettings, useSettings } from '../lib/settings';

export function NewMeeting() {
  const nav = useNavigate();
  const toast = useToast();
  const settings = useSettings();
  const [code, setCode] = useState(generateMeetingCode);
  const link = meetingUrl(code);

  const copy = async (what: 'link' | 'invite') => {
    const text =
      what === 'link'
        ? link
        : `${settings.displayName || 'Someone'} is inviting you to a Yapameet call.\n\nJoin: ${link}\nCode: ${code}`;
    toast((await copyText(text)) ? (what === 'link' ? 'Link copied' : 'Invitation copied') : 'Could not copy', 'success');
  };

  const share = async () => {
    try {
      await navigator.share({ title: 'Join my Yapameet call', url: link });
    } catch {
      /* user cancelled */
    }
  };

  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader />
      <main className="center-page">
        <div className="card create-card">
          <Link to="/" className="back-link">
            <ArrowLeft size={16} /> Back
          </Link>
          <h1>Your meeting is ready</h1>
          <p className="muted">
            Share this link with the people you want in the call. It works any time: the meeting exists while at least
            one person is in it.
          </p>

          <label className="field">
            <span>Your name</span>
            <input
              value={settings.displayName}
              onChange={(e) => updateSettings({ displayName: e.target.value.slice(0, 40) })}
              placeholder="What should people call you?"
              maxLength={40}
            />
          </label>

          <div className="code-display" data-testid="new-code">
            {code}
          </div>
          <div className="link-box">
            <span className="link-text" data-testid="new-link">
              {link}
            </span>
            <button className="icon-btn" onClick={() => void copy('link')} aria-label="Copy link" title="Copy link">
              <Copy size={18} />
            </button>
          </div>

          <div className="new-qr-row">
            <QrCode text={link} size={120} />
            <span className="muted small">On your phone? Scan this with the camera to join from there.</span>
          </div>

          <div className="create-actions">
            <button className="btn btn-primary btn-lg" onClick={() => nav(`/meeting/${code}`)} data-testid="start-meeting">
              <Video size={20} /> Start meeting now
            </button>
            <button className="btn btn-ghost" onClick={() => void copy('invite')}>
              <Copy size={18} /> Copy invitation
            </button>
            {'share' in navigator && (
              <button className="btn btn-ghost" onClick={() => void share()}>
                <Share2 size={18} /> Share
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => setCode(generateMeetingCode())}>
              <RefreshCw size={18} /> New code
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
