import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertTriangle } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { DevicePanel } from '../components/DevicePanel';
import { Toggle } from '../components/controls';
import { LocalMedia } from '../rtc/LocalMedia';
import { updateSettings, useSettings } from '../lib/settings';
import { config, hasTurn } from '../config';

export function SettingsPage() {
  const s = useSettings();
  const [local] = useState(() => new LocalMedia());

  useEffect(() => {
    // Preview devices only while this page is open; never leave the camera running.
    local.camOn = true;
    local.micOn = true;
    void local.start();
    return () => local.dispose();
  }, [local]);

  return (
    <div className="page">
      <div className="bg-glow" aria-hidden="true" />
      <SiteHeader />
      <main className="settings-page">
        <Link to="/" className="back-link">
          <ArrowLeft size={16} /> Back
        </Link>
        <h1>Settings</h1>
        <p className="muted">Saved in this browser. They apply to every meeting you join from here.</p>

        <div className="settings-grid">
          <div className="card">
            <section className="panel-section">
              <h3>Profile</h3>
              <label className="field">
                <span>Display name</span>
                <input
                  value={s.displayName}
                  onChange={(e) => updateSettings({ displayName: e.target.value.slice(0, 40) })}
                  placeholder="Your name"
                  maxLength={40}
                  data-testid="settings-name"
                />
              </label>
            </section>
            <section className="panel-section">
              <h3>Joining</h3>
              <Toggle label="Join with microphone muted" checked={s.joinMuted} onChange={(v) => updateSettings({ joinMuted: v })} />
              <Toggle label="Join with camera off" checked={s.joinCameraOff} onChange={(v) => updateSettings({ joinCameraOff: v })} />
              <Toggle label="Join, leave and message sounds" checked={s.sounds} onChange={(v) => updateSettings({ sounds: v })} />
              <Toggle
                label="Show connection details"
                hint="Direct vs relayed connection and round-trip time on each tile"
                checked={s.showConnectionDetails}
                onChange={(v) => updateSettings({ showConnectionDetails: v })}
              />
            </section>
            <section className="panel-section">
              <h3>Network</h3>
              <ul className="infra-list">
                <li>
                  <CheckCircle2 size={16} className="ok" /> Signaling: {config.signaling === 'supabase' ? 'Supabase Realtime' : 'Free public MQTT brokers'}
                </li>
                <li>
                  <CheckCircle2 size={16} className="ok" /> STUN: {config.stunUrls.length} public server{config.stunUrls.length === 1 ? '' : 's'}
                </li>
                <li>
                  {hasTurn() ? <CheckCircle2 size={16} className="ok" /> : <AlertTriangle size={16} className="warn" />} TURN relay:{' '}
                  {hasTurn() ? 'configured' : 'not configured (calls between some strict networks may fail)'}
                </li>
              </ul>
            </section>
          </div>
          <div className="card">
            <DevicePanel local={local} section="all" />
          </div>
        </div>
      </main>
    </div>
  );
}
