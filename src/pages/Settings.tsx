import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { SiteHeader } from '../components/Brand';
import { SETTINGS_SECTIONS, SettingsView, sectionNeedsDevices, type SettingsSection } from '../components/SettingsPanels';
import { LocalMedia } from '../rtc/LocalMedia';

export function SettingsPage() {
  const [local] = useState(() => new LocalMedia());
  const [section, setSection] = useState<SettingsSection>(() => {
    const h = location.hash.slice(1) as SettingsSection;
    return SETTINGS_SECTIONS.some((x) => x.id === h) ? h : 'profile';
  });
  const needsDevices = sectionNeedsDevices(section);

  useEffect(() => {
    history.replaceState(null, '', `#${section}`);
  }, [section]);

  // Only open the camera and microphone while a device section is showing.
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
      <SiteHeader bare />
      <main className="settings-page">
        <Link to="/" className="back-link">
          <ArrowLeft size={16} /> Home
        </Link>
        <h1>Settings</h1>
        <p className="muted">Saved in this browser and used for every call you join from here.</p>
        <div className="card settings-card">
          <SettingsView local={local} section={section} onSection={setSection} />
        </div>
      </main>
    </div>
  );
}
