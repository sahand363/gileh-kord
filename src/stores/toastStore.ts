import { writable } from 'svelte/store';

export interface ToastState {
  show: boolean;
  message: string;
}

export const toastState = writable<ToastState>({ show: false, message: '' });

let toastTimer: any = null;

export function showToast(message: string, duration: number = 2600) {
  clearTimeout(toastTimer);
  toastState.set({ show: true, message });
  toastTimer = setTimeout(() => {
    toastState.set({ show: false, message: '' });
  }, duration);
}
