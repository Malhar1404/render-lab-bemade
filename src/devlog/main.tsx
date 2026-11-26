import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { DevlogApp } from './DevlogApp';
import './devlog.css';
import './detail.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DevlogApp />
  </StrictMode>,
);
