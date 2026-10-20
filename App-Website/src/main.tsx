import './polyfills';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './data/store';
import App from './App';
import { AppExperience } from './components/Experience';
import './styles.css';
import './motion.css';
import './admin.css';
import './accounts.css';
import '@fontsource/bricolage-grotesque/700.css';
import '@fontsource/bricolage-grotesque/800.css';
import '@fontsource/hind-siliguri/400.css';
import '@fontsource/hind-siliguri/500.css';
import '@fontsource/hind-siliguri/600.css';
import '@fontsource/hind-siliguri/700.css';
import '@fontsource/ibm-plex-mono/500.css';
// /admin (without the hash) opens the admin panel, also on hosts that only fall back to index.html.
if (/\/admin\/?$/.test(location.pathname) && !location.hash) location.replace(location.pathname.replace(/admin\/?$/, '') + '#/admin');
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(e: Error) {
    return { error: e.message };
  }
  render() {
    return this.state.error ? (
      <main className="welcome">
        <h1>Let’s reopen GreenBiz</h1>
        <p>{this.state.error}</p>
        <button className="btn primary" onClick={() => location.reload()}>
          Try again
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <StoreProvider>
        <AppExperience />
        <App />
      </StoreProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
