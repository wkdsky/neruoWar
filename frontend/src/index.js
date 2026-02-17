import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const isResizeObserverNoise = (message = '') => {
  if (typeof message !== 'string') return false;
  return (
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded')
  );
};

const resolveErrorMessage = (input) => {
  if (!input) return '';
  if (typeof input === 'string') return input;
  if (typeof input?.message === 'string') return input.message;
  return '';
};

const shouldSuppressResizeObserverNoise = (event) => {
  const message = resolveErrorMessage(event?.message) || resolveErrorMessage(event?.error);
  return isResizeObserverNoise(message);
};

const suppressResizeObserverEvent = (event) => {
  if (!shouldSuppressResizeObserverNoise(event)) return;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
};

window.addEventListener('error', suppressResizeObserverEvent, true);

window.onerror = (message) => {
  if (!isResizeObserverNoise(resolveErrorMessage(message))) return false;
  return true;
};

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = resolveErrorMessage(reason);
  if (!isResizeObserverNoise(message)) return;
  event.preventDefault?.();
  event.stopImmediatePropagation?.();
}, true);

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
