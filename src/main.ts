import './styles/main.css';
import './styles/gileh-kord-theme.css';
import App from './App.svelte';
import {
  initNetworkListeners,
  registerAppServiceWorker
} from './services/pwaService';
import { apiClient } from './services/api/apiClient';

initNetworkListeners();

apiClient.configure({ baseUrl: '', enabled: true });
void apiClient.checkHealth();

const app = new App({
  target: document.getElementById('app')!
});

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    void registerAppServiceWorker();
  });
}

export default app;
