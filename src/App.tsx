import { useCallback, useEffect } from 'react';
import { Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { NewMeeting } from './pages/NewMeeting';
import { JoinPage } from './pages/Join';
import { MeetingPage } from './pages/Meeting';
import { SettingsPage } from './pages/Settings';
import { NotFound } from './pages/NotFound';
import { FxLayer } from './components/FxLayer';
import { useToast } from './components/Toast';
import { findEgg, updateSettings, useSettings } from './lib/settings';
import { callState, fxBus, useKonami } from './lib/fx';
import { sounds } from './lib/sounds';

export function App() {
  const s = useSettings();
  const toast = useToast();

  useEffect(() => {
    document.documentElement.dataset.theme = s.theme;
    document.documentElement.classList.toggle('reduce-motion', s.reduceMotion);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg || '#0b0c15');
  }, [s.theme, s.reduceMotion]);

  // Konami code: unlocks the Arcade theme. In a call, CallView also sends confetti to everyone.
  const onKonami = useCallback(() => {
    if (findEgg('konami')) {
      sounds.secret();
      toast('🕹️ Secret found: Old School. Arcade theme unlocked!', 'success');
      updateSettings({ theme: 'arcade' });
    }
    if (!callState.active) fxBus.emit('confetti');
  }, [toast]);
  useKonami(onKonami);

  return (
    <>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/new" element={<NewMeeting />} />
        <Route path="/join" element={<JoinPage />} />
        <Route path="/meeting/:code" element={<MeetingPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <FxLayer />
    </>
  );
}
