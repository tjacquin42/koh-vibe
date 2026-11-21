// Fonts are bundled, never fetched: the web view's security policy blocks
// Google Fonts, and the panel has to render the same offline.
import '@fontsource-variable/bricolage-grotesque/opsz.css';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import './styles/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createBridge } from './bridge';

const root = document.getElementById('root');
if (root !== null) {
  createRoot(root).render(
    <StrictMode>
      <App bridge={createBridge()} />
    </StrictMode>,
  );
}
