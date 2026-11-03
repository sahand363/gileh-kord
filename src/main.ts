import './styles/main.css';
import App from './App.svelte';

const app = new App({
  target: document.getElementById('app')!
});

if (
  import.meta.env.PROD &&
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  (window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1')
) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.error('Service Worker registration failed:', err);
    });
  });
}

export default app;
