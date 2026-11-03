import { writable } from 'svelte/store';

export type AccessContextMode = 'https-domain' | 'localhost' | 'http-ip';
export type ServiceWorkerStatus =
  | 'active'
  | 'registering'
  | 'unsupported-http'
  | 'unsupported-browser'
  | 'disabled-dev'
  | 'error';

export interface RuntimeEnvironmentState {
  isOnline: boolean;
  isSecureContext: boolean;
  accessMode: AccessContextMode;
  swStatus: ServiceWorkerStatus;
  swMessage: string;
}

export function detectAccessMode(loc?: {
  protocol: string;
  hostname: string;
}): AccessContextMode {
  if (!loc) return 'localhost';
  if (loc.protocol === 'https:') return 'https-domain';
  if (
    loc.hostname === 'localhost' ||
    loc.hostname === '127.0.0.1' ||
    loc.hostname === '[::1]'
  ) {
    return 'localhost';
  }
  return 'http-ip';
}

const initialAccessMode =
  typeof window !== 'undefined' ? detectAccessMode(window.location) : 'localhost';

const initialOnline =
  typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean'
    ? navigator.onLine
    : true;

const initialSecure =
  typeof window !== 'undefined' && typeof window.isSecureContext === 'boolean'
    ? window.isSecureContext
    : initialAccessMode !== 'http-ip';

export const runtimeState = writable<RuntimeEnvironmentState>({
  isOnline: initialOnline,
  isSecureContext: initialSecure,
  accessMode: initialAccessMode,
  swStatus: initialAccessMode === 'http-ip' ? 'unsupported-http' : 'registering',
  swMessage:
    initialAccessMode === 'http-ip'
      ? 'دسترسی از طریق HTTP IP: پایگاه داده محلی (IndexedDB) کاملاً فعال است؛ کش آفلاین مرورگر نیازمند HTTPS است.'
      : 'در حال بررسی سرویس آفلاین...'
});

export function initNetworkListeners(): void {
  if (typeof window === 'undefined') return;

  const updateOnline = () => {
    runtimeState.update((s) => ({
      ...s,
      isOnline: navigator.onLine
    }));
  };

  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
}

/**
 * Registers the Service Worker when supported (HTTPS or localhost) and gracefully
 * degrades on plain HTTP IP addresses without throwing or blocking any feature.
 */
export async function registerAppServiceWorker(options?: {
  isProd?: boolean;
  win?: Window & typeof globalThis;
  nav?: Navigator;
}): Promise<ServiceWorkerStatus> {
  const isProd = options?.isProd ?? import.meta.env.PROD;
  const win = options?.win ?? (typeof window !== 'undefined' ? window : undefined);
  const nav = options?.nav ?? (typeof navigator !== 'undefined' ? navigator : undefined);

  if (!win || !nav) {
    return 'unsupported-browser';
  }

  const accessMode = detectAccessMode(win.location);

  if (accessMode === 'http-ip' && !win.isSecureContext) {
    const status: ServiceWorkerStatus = 'unsupported-http';
    runtimeState.update((s) => ({
      ...s,
      accessMode,
      isSecureContext: false,
      swStatus: status,
      swMessage:
        'حالت HTTP IP فعال است: ثبت خرید و ذخیره‌سازی IndexedDB بدون نیاز به HTTPS کار می‌کند.'
    }));
    return status;
  }

  if (!('serviceWorker' in nav) || !nav.serviceWorker) {
    const status: ServiceWorkerStatus = 'unsupported-browser';
    runtimeState.update((s) => ({
      ...s,
      accessMode,
      swStatus: status,
      swMessage: 'مرورگر فعلی از Service Worker پشتیبانی نمی‌کند، اما پایگاه داده محلی فعال است.'
    }));
    return status;
  }

  if (!isProd) {
    const status: ServiceWorkerStatus = 'disabled-dev';
    runtimeState.update((s) => ({
      ...s,
      accessMode,
      swStatus: status,
      swMessage: 'حالت توسعه (Dev): ذخیره‌سازی محلی IndexedDB فعال است.'
    }));
    return status;
  }

  try {
    await nav.serviceWorker.register('/sw.js');
    const status: ServiceWorkerStatus = 'active';
    runtimeState.update((s) => ({
      ...s,
      accessMode,
      isSecureContext: true,
      swStatus: status,
      swMessage: 'سرویس آفلاین (PWA App Shell) و پایگاه داده محلی فعال است.'
    }));
    return status;
  } catch {
    const status: ServiceWorkerStatus = 'error';
    runtimeState.update((s) => ({
      ...s,
      accessMode,
      swStatus: status,
      swMessage: 'عدم ثبت Service Worker؛ ذخیره‌سازی محلی (IndexedDB) همچنان فعال است.'
    }));
    return status;
  }
}
