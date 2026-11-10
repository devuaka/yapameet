import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@fontsource-variable/inter';
import '@fontsource-variable/space-grotesk';
import './styles/global.css';
import './styles/themes.css';
import './styles/features.css';
import './styles/fun.css';
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
