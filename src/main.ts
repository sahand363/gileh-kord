import './styles/main.css';
import './styles/gileh-kord-theme.css';
import App from './App.svelte';
import {
  initNetworkListeners,
  registerAppServiceWorker
} from './services/pwaService';
import { apiClient } from './services/api/apiClient';
import { getOperatingMode, getConfiguredServerUrl } from './services/ManagerAuthService';

initNetworkListeners();

const mode = getOperatingMode();
const serverUrl = getConfiguredServerUrl();

if (mode === 'standalone') {
  apiClient.configure({ baseUrl: '', enabled: false });
} else if (mode === 'server') {
  apiClient.configure({ baseUrl: serverUrl, enabled: true });
  void apiClient.checkHealth();
} else {
  // Default unconfigured state: check if served directly by web server
  const isCapacitorOrLocal =
    typeof window !== 'undefined' &&
    (window.location.protocol === 'capacitor:' ||
      window.location.hostname === 'localhost');
  apiClient.configure({ baseUrl: '', enabled: !isCapacitorOrLocal });
}

const app = new App({
  target: document.getElementById('app')!
});

if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    void registerAppServiceWorker();
  });
}

export default app;
