import { writable } from 'svelte/store';

export type AppPage = 'entry' | 'history' | 'settings';

export const currentPage = writable<AppPage>('entry');

export function navigateTo(page: AppPage) {
  currentPage.set(page);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
