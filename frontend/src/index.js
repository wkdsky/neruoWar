import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

const isResizeObserverNoise = (message = '') =>
  typeof message === 'string' &&
  (
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded')
  );

window.addEventListener('error', (event) => {
  if (isResizeObserverNoise(event?.message)) {
    event.stopImmediatePropagation();
  }
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event?.reason;
  const message = typeof reason === 'string' ? reason : (reason?.message || '');
  if (isResizeObserverNoise(message)) {
    event.preventDefault();
  }
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
