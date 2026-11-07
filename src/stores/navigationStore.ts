import { writable } from 'svelte/store';
import type { AppPage } from '../models/types';
import { isManagerUnlocked } from '../services/ManagerAuthService';

export type { AppPage };

export type ManagerSubTab =
  | 'dashboard'
  | 'overview'
  | 'menu'
  | 'history_logs'
  | 'employees'
  | 'inventory'
  | 'products'
  | 'suppliers'
  | 'backup'
  | 'settings';

export interface NavSectionMeta {
  id: AppPage;
  label: string;
  shortLabel: string;
  icon: string;
  primary: boolean;
}

export const NAV_SECTIONS: NavSectionMeta[] = [
  { id: 'entry', label: 'ثبت خرید', shortLabel: 'ثبت خرید', icon: '＋', primary: true },
  { id: 'expenses', label: 'هزینه‌ها', shortLabel: 'هزینه‌ها', icon: '¤', primary: true },
  { id: 'revenue', label: 'درآمد', shortLabel: 'درآمد', icon: '₿', primary: true },
  { id: 'timesheets', label: 'تایم‌شیت', shortLabel: 'تایم‌شیت', icon: '◷', primary: true },
  { id: 'manager', label: 'پنل مدیریت', shortLabel: 'مدیریت', icon: '⌑', primary: true }
];

const PUBLIC_PAGES = new Set<AppPage>([
  'entry',
  'expenses',
  'revenue',
  'timesheets',
  'manager'
]);

const MANAGER_PROTECTED_SUBTABS = new Set<ManagerSubTab>([
  'dashboard',
  'overview',
  'menu',
  'history_logs',
  'employees',
  'inventory',
  'products',
  'suppliers',
  'backup',
  'settings'
]);

// Default first tab inside Manager is 'dashboard' (پیشخوان)
export const activeManagerTab = writable<ManagerSubTab>('dashboard');

function resolveRoute(rawPage: string): AppPage {
  const clean = rawPage.replace('#', '').trim() as AppPage;
  if (clean === 'history') {
    isManagerUnlocked.set(false);
    return 'entry';
  }
  if (MANAGER_PROTECTED_SUBTABS.has(clean as ManagerSubTab)) {
    activeManagerTab.set(clean as ManagerSubTab);
    return 'manager';
  }
  if (PUBLIC_PAGES.has(clean)) {
    if (clean !== 'manager') {
      isManagerUnlocked.set(false);
    }
    return clean;
  }
  isManagerUnlocked.set(false);
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
  if (page === 'history') {
    isManagerUnlocked.set(false);
    currentPage.set('entry');
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        const historyEl = document.getElementById('embeddedPurchaseHistory');
        if (historyEl) {
          historyEl.scrollIntoView({ behavior: 'smooth' });
        }
      }, 60);
    }
    return;
  }

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

  // Leaving Manager automatically locks the Manager gate so it asks for password next time
  if (page !== 'manager') {
    isManagerUnlocked.set(false);
  }

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
