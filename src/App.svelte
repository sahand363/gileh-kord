<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPage } from './stores/navigationStore';
  import { loadPurchases } from './stores/purchaseStore';
  import {
    managerAuthService,
    isAppAuthenticated,
    activeManagerUsername
  } from './services/ManagerAuthService';
  import { showToast } from './stores/toastStore';
  import Topbar from './components/common/Topbar.svelte';
  import BottomNav from './components/common/BottomNav.svelte';
  import Toast from './components/common/Toast.svelte';

  import DashboardPage from './features/dashboard/DashboardPage.svelte';
  import PurchaseEntryPage from './features/purchases/PurchaseEntryPage.svelte';
  import TimesheetsPage from './features/timesheets/TimesheetsPage.svelte';
  import RevenuePage from './features/revenue/RevenuePage.svelte';
  import ManagerPage from './features/manager/ManagerPage.svelte';

  let appUsername = 'admin';
  let appPassword = '';
  let rememberDays = 30;
  let appAuthError = '';
  let isCheckingAuth = false;

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      appUsername = $activeManagerUsername;
    }
    await loadPurchases(true);
  });

  async function handleAppGateLogin() {
    if (isCheckingAuth) return;
    appAuthError = '';
    isCheckingAuth = true;
    try {
      const res = await managerAuthService.loginAppGate(
        appUsername,
        appPassword,
        rememberDays
      );
      if (!res.success) {
        appAuthError = res.error || 'نام کاربری یا رمز عبور نادرست است.';
        return;
      }
      appPassword = '';
      showToast('خوش آمدید! ورود شما برای ۳۰ روز در این مرورگر ذخیره شد.');
    } finally {
      isCheckingAuth = false;
    }
  }
</script>

{#if !$isAppAuthenticated}
  <!-- First Login Gate: Whole-App Entry (Saved in 30-Day Cookie) -->
  <div class="app-auth-gate">
    <div class="panel login-panel">
      <div class="brand-mark" style="margin: 0 auto 14px; width: 52px; height: 52px; font-size: 24px;">
        گ
      </div>
      <h1 style="font-size: 21px; margin: 0; color: var(--green);">ورود به سامانه گیله‌کُرد</h1>
      <p style="color: var(--muted); font-size: 12px; margin: 8px 0 20px; line-height: 1.8;">
        نام کاربری و رمز عبور خود را وارد کنید. ورود اول شما به مدت ۳۰ روز در کوکی مرورگر ذخیره می‌ماند.
      </p>

      <form on:submit|preventDefault={handleAppGateLogin} novalidate>
        <div class="field">
          <label for="appGateUser">نام کاربری</label>
          <input
            id="appGateUser"
            bind:value={appUsername}
            autocomplete="username"
            placeholder="نام کاربری"
            required
          />
        </div>

        <div class="field">
          <label for="appGatePass">رمز عبور</label>
          <input
            id="appGatePass"
            type="password"
            bind:value={appPassword}
            autocomplete="current-password"
            placeholder="رمز عبور"
            required
          />
        </div>

        <div class="field" style="margin-bottom: 12px;">
          <label style="display: flex; align-items: center; gap: 8px; font-size: 11.5px; cursor: pointer;">
            <input
              type="checkbox"
              checked={rememberDays === 30}
              on:change={(e) => {
                const target = e.currentTarget;
                rememberDays = target && target.checked ? 30 : 1;
              }}
              style="width: 18px; height: 18px; min-height: 18px;"
            />
            <span>به خاطر سپردن ورود در این دستگاه به مدت ۳۰ روز</span>
          </label>
        </div>

        {#if appAuthError}
          <div class="form-error" role="alert">{appAuthError}</div>
        {/if}

        <button type="submit" class="primary-btn" disabled={isCheckingAuth}>
          <span>{isCheckingAuth ? 'در حال بررسی...' : 'ورود به برنامه'}</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
    <Toast />
  </div>
{:else}
  <div class="app-shell">
    <Topbar />

    <main class="main-wrap">
      {#if $currentPage === 'dashboard'}
        <DashboardPage />
      {:else if $currentPage === 'entry'}
        <PurchaseEntryPage />
      {:else if $currentPage === 'timesheets'}
        <TimesheetsPage />
      {:else if $currentPage === 'revenue'}
        <RevenuePage />
      {:else}
        <ManagerPage />
      {/if}
    </main>

    <BottomNav />
    <Toast />
  </div>
{/if}
