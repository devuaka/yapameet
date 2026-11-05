import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Egg, Keyboard, Mic, Palette, RotateCcw, Sparkles, User, Video, Wifi } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { PfpEditor } from '../components/PfpEditor';
import { AppearancePanel, AudioPanel, EffectsPanel, MeetingPanel, SecretsPanel, VideoPanel } from '../components/SettingsPanels';
import { useToast } from '../components/Toast';
import { LocalMedia } from '../rtc/LocalMedia';
import { resetSettings, updateSettings, useSettings } from '../lib/settings';
import { config, hasTurn } from '../config';
import { EGGS } from '../lib/themes';

type Section = 'profile' | 'appearance' | 'audio' | 'video' | 'effects' | 'meeting' | 'network' | 'secrets';

const GROUPS: { title: string; items: { id: Section; label: string; icon: React.ReactNode }[] }[] = [
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
      { id: 'effects', label: 'Backgrounds & filters', icon: <Sparkles size={18} /> },
    ],
  },
  {
    title: 'Calls',
    items: [
      { id: 'meeting', label: 'Meetings & shortcuts', icon: <Keyboard size={18} /> },
      { id: 'network', label: 'Network', icon: <Wifi size={18} /> },
    ],
  },
  { title: 'Extras', items: [{ id: 'secrets', label: 'Secrets', icon: <Egg size={18} /> }] },
];
const SECTIONS = GROUPS.flatMap((g) => g.items);

export function SettingsPage() {
  const s = useSettings();
  const toast = useToast();
  const [local] = useState(() => new LocalMedia());
  const [section, setSection] = useState<Section>(() => {
    const h = location.hash.slice(1) as Section;
    return SECTIONS.some((x) => x.id === h) ? h : 'profile';
  });
  const current = SECTIONS.find((x) => x.id === section)!;
  const needsDevices = section === 'audio' || section === 'video' || section === 'effects';

  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);

  // Only open the camera/mic while a device section is showing.
  useEffect(() => {
    if (!needsDevices) return;
    local.camOn = true;
    local.micOn = true;
    void local.start();
    return () => local.stopAll();
  }, [local, needsDevices]);
  useEffect(() => () => local.dispose(), [local]);

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

        <div className="settings-layout">
          <nav className="settings-nav" aria-label="Settings sections">
            {GROUPS.map((g) => (
              <div className="settings-nav-group" key={g.title}>
                <div className="settings-nav-title">{g.title}</div>
                {g.items.map((x) => (
                  <button key={x.id} className={section === x.id ? 'active' : ''} onClick={() => setSection(x.id)} data-testid={`section-${x.id}`}>
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
          <div className="card settings-card">
            <h2 className="settings-card-title">
              {current.icon} {current.label}
            </h2>
            {section === 'profile' && (
              <div className="device-panel">
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
                  <h3>Profile picture</h3>
                  <PfpEditor name={s.displayName} />
                </section>
                <section className="panel-section">
                  <h3>Reset</h3>
                  <p className="muted small">Restore every setting to its default. Your name and found secrets are kept.</p>
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
            )}
            {section === 'appearance' && <AppearancePanel />}
            {section === 'audio' && <AudioPanel local={local} />}
            {section === 'video' && <VideoPanel local={local} />}
            {section === 'effects' && <EffectsPanel local={local} />}
            {section === 'meeting' && <MeetingPanel />}
            {section === 'secrets' && <SecretsPanel />}
            {section === 'network' && (
              <div className="device-panel">
                <section className="panel-section">
                  <h3>Network</h3>
                  <ul className="infra-list">
                    <li>
                      <CheckCircle2 size={16} className="ok" /> Signaling:{' '}
                      {config.signaling === 'supabase' ? 'Supabase Realtime' : 'Free public MQTT brokers'} (end-to-end encrypted)
                    </li>
                    <li>
                      <CheckCircle2 size={16} className="ok" /> STUN: {config.stunUrls.length} public server{config.stunUrls.length === 1 ? '' : 's'}
                    </li>
                    <li>
                      {hasTurn() ? <CheckCircle2 size={16} className="ok" /> : <AlertTriangle size={16} className="warn" />} TURN relay:{' '}
                      {hasTurn() ? 'configured' : 'not configured (calls between some strict networks may fail)'}
                    </li>
                  </ul>
                  <p className="muted small">
                    Video goes directly between participants. Tip: turn on "Show connection stats on tiles" (Meetings) to see
                    resolution, frame rate, bitrate and delay for each person.
                  </p>
                </section>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
