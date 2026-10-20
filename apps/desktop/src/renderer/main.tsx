import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// <!-- req webcorefoundation:a47f7f42.6a8b --> <!-- req webcorefoundation:a47f7f42.1fd6 -->

import { App } from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('renderer bootstrap failed: #root not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
