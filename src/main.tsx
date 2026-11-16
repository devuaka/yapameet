import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/bricolage-grotesque';
import './styles/tokens.css';
import './styles/base.css';
import './styles/site.css';
import './styles/call.css';
import './styles/activities.css';
import './styles/fx.css';
import { App } from './App';
import { ToastProvider } from './components/Toast';
import { getSettings } from './lib/settings';

// Apply the saved theme before the first paint (no flash of the default theme).
document.documentElement.dataset.theme = getSettings().theme;

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
