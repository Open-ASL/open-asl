import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthProvider';
import { installErrorLog } from './diagnostics/errorLog';
import { installStaleBuildReload } from './diagnostics/staleBuild';
import { installTranslateGuard } from './diagnostics/translateGuard';
import { ErrorBoundary } from './ui/ErrorBoundary';
import './styles.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import './lobby-v2/lobby.css';
import './aar/aar.css';

installErrorLog();
installTranslateGuard();
installStaleBuildReload();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ErrorBoundary what="the app">
          <App />
        </ErrorBoundary>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
