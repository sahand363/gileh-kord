import './styles/main.css';
import App from './App.svelte';
import {
  initNetworkListeners,
  registerAppServiceWorker
} from './services/pwaService';

initNetworkListeners();

const app = new App({
  target: document.getElementById('app')!
});

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    void registerAppServiceWorker();
  });
}

export default app;
