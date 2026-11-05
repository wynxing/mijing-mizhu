import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useGameStore } from './state/store';
import './style.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('缺少 #root 挂载点');
}

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__mijing = { store: useGameStore };
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
