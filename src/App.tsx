import { Route, Routes } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { NewMeeting } from './pages/NewMeeting';
import { JoinPage } from './pages/Join';
import { MeetingPage } from './pages/Meeting';
import { SettingsPage } from './pages/Settings';
import { NotFound } from './pages/NotFound';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/new" element={<NewMeeting />} />
      <Route path="/join" element={<JoinPage />} />
      <Route path="/meeting/:code" element={<MeetingPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
