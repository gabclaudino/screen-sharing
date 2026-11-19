import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Elemento #root não encontrado');
}

// Erros fora do React (promises sem catch, eventos do WebRTC) nunca devem passar em branco.
window.addEventListener('unhandledrejection', (event) => {
  console.error('[app] promise rejeitada sem tratamento:', event.reason);
});
window.addEventListener('error', (event) => {
  console.error('[app] erro não capturado:', event.error ?? event.message);
});

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
