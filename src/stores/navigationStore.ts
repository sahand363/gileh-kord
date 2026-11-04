import { writable } from 'svelte/store';
import type { AppPage } from '../models/types';

export type { AppPage };

export type ManagerSubTab =
  | 'overview'
  | 'employees'
  | 'suppliers'
  | 'inventory'
  | 'reports'
  | 'backup';

export interface NavSectionMeta {
  id: AppPage;
  label: string;
  shortLabel: string;
  icon: string;
  primary: boolean;
}

export const NAV_SECTIONS: NavSectionMeta[] = [
  { id: 'entry', label: 'ثبت خرید', shortLabel: 'ثبت خرید', icon: '＋', primary: true },
  { id: 'history', label: 'تاریخچه خریدها', shortLabel: 'خریدها', icon: '▤', primary: true },
  { id: 'timesheets', label: 'تایم‌شیت', shortLabel: 'تایم‌شیت', icon: '◷', primary: true },
  { id: 'revenue', label: 'درآمد', shortLabel: 'درآمد', icon: '₿', primary: true },
  { id: 'dashboard', label: 'پیشخوان', shortLabel: 'پیشخوان', icon: '⊞', primary: false },
  { id: 'products', label: 'کالاها', shortLabel: 'کالاها', icon: '❖', primary: false },
  { id: 'expenses', label: 'هزینه‌ها', shortLabel: 'هزینه‌ها', icon: '¤', primary: false },
  { id: 'settings', label: 'تنظیمات', shortLabel: 'تنظیمات', icon: '⚙', primary: false },
  { id: 'manager', label: 'پنل مدیریت', shortLabel: 'مدیریت', icon: '⌑', primary: false }
];

const PUBLIC_PAGES = new Set<AppPage>(NAV_SECTIONS.map((s) => s.id));

const MANAGER_PROTECTED_SUBTABS = new Set<ManagerSubTab>([
  'overview',
  'employees',
  'suppliers',
  'inventory',
  'reports',
  'backup'
]);

export const activeManagerTab = writable<ManagerSubTab>('overview');

function resolveRoute(rawPage: string): AppPage {
  const clean = rawPage.replace('#', '').trim() as AppPage;
  if (MANAGER_PROTECTED_SUBTABS.has(clean as ManagerSubTab)) {
    activeManagerTab.set(clean as ManagerSubTab);
    return 'manager';
  }
  if (PUBLIC_PAGES.has(clean)) {
    return clean;
  }
  return 'entry';
}

function getInitialPage(): AppPage {
  if (typeof window !== 'undefined' && window.location.hash) {
    return resolveRoute(window.location.hash);
  }
  return 'entry';
}

export const currentPage = writable<AppPage>(getInitialPage());

export function navigateTo(page: AppPage | ManagerSubTab): void {
  if (MANAGER_PROTECTED_SUBTABS.has(page as ManagerSubTab)) {
    activeManagerTab.set(page as ManagerSubTab);
    currentPage.set('manager');
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '#manager');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
    return;
  }

  if (!PUBLIC_PAGES.has(page as AppPage)) return;
  currentPage.set(page as AppPage);
  if (typeof window !== 'undefined') {
    if (window.location.hash !== `#${page}`) {
      window.history.replaceState(null, '', `#${page}`);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

export function openManagerSubTab(subTab: ManagerSubTab): void {
  activeManagerTab.set(subTab);
  navigateTo('manager');
}

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    const target = resolveRoute(window.location.hash);
    currentPage.set(target);
  });
}
