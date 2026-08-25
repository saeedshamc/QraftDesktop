// Safeguard to prevent "Cannot set property fetch of #<Window> which has only a getter" error.
// This handles cases where external scripts or sandboxes attempt to override window.fetch.
try {
  let activeFetch = window.fetch;
  Object.defineProperty(window, 'fetch', {
    get() {
      return activeFetch;
    },
    set(value) {
      activeFetch = value;
    },
    configurable: true,
    enumerable: true,
  });
} catch (e) {
  console.warn('Unable to redefine window.fetch setter:', e);
}

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
