import { writable } from 'svelte/store';
import type { AppPage } from '../models/types';

export type { AppPage };

export interface NavSectionMeta {
  id: AppPage;
  label: string;
  shortLabel: string;
  icon: string;
  primary: boolean;
}

export const NAV_SECTIONS: NavSectionMeta[] = [
  { id: 'dashboard', label: 'پیشخوان', shortLabel: 'پیشخوان', icon: '⊞', primary: true },
  { id: 'entry', label: 'ثبت خرید', shortLabel: 'ثبت خرید', icon: '＋', primary: true },
  { id: 'history', label: 'تاریخچه خریدها', shortLabel: 'خریدها', icon: '▤', primary: true },
  { id: 'products', label: 'کالاها', shortLabel: 'کالاها', icon: '❖', primary: true },
  { id: 'suppliers', label: 'تأمین‌کنندگان', shortLabel: 'فروشندگان', icon: '◈', primary: false },
  { id: 'inventory', label: 'انبار و موجودی', shortLabel: 'انبار', icon: '◫', primary: false },
  { id: 'expenses', label: 'هزینه‌ها', shortLabel: 'هزینه‌ها', icon: '¤', primary: false },
  { id: 'reports', label: 'گزارش‌ها', shortLabel: 'گزارش‌ها', icon: '↗', primary: false },
  { id: 'backup', label: 'پشتیبان‌گیری', shortLabel: 'پشتیبان', icon: '⇧', primary: false },
  { id: 'settings', label: 'تنظیمات', shortLabel: 'تنظیمات', icon: '⚙', primary: false }
];

const VALID_PAGES = new Set<AppPage>(NAV_SECTIONS.map((s) => s.id));

function getInitialPage(): AppPage {
  if (typeof window !== 'undefined' && window.location.hash) {
    const raw = window.location.hash.replace('#', '').trim() as AppPage;
    if (VALID_PAGES.has(raw)) {
      return raw;
    }
  }
  return 'entry';
}

export const currentPage = writable<AppPage>(getInitialPage());

export function navigateTo(page: AppPage): void {
  if (!VALID_PAGES.has(page)) return;
  currentPage.set(page);
  if (typeof window !== 'undefined') {
    if (window.location.hash !== `#${page}`) {
      window.history.replaceState(null, '', `#${page}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const raw = window.location.hash.replace('#', '').trim() as AppPage;
    if (VALID_PAGES.has(raw)) {
      currentPage.set(raw);
    }
  });
}
