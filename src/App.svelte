<script lang="ts">
  import { onMount } from 'svelte';
  import { currentPage } from './stores/navigationStore';
  import { loadPurchases, acceptServerUpdate } from './stores/purchaseStore';
  import {
    managerAuthService,
    isAppAuthenticated,
    isManagerConfigured,
    activeManagerUsername,
    operatingModeStore,
    configuredServerUrlStore,
    setConnectionConfig
  } from './services/ManagerAuthService';
  import { apiClient } from './services/api/apiClient';
  import { settingsRepository } from './services/repositories/SettingsRepository';
  import { showToast } from './stores/toastStore';
  import Topbar from './components/common/Topbar.svelte';
  import BottomNav from './components/common/BottomNav.svelte';
  import Toast from './components/common/Toast.svelte';

  import PurchaseEntryPage from './features/purchases/PurchaseEntryPage.svelte';
  import ExpensesPage from './features/expenses/ExpensesPage.svelte';
  import RevenuePage from './features/revenue/RevenuePage.svelte';
  import TimesheetsPage from './features/timesheets/TimesheetsPage.svelte';
  import ManagerPage from './features/manager/ManagerPage.svelte';

  let setupChoice: 'standalone' | 'server' = 'standalone';
  let serverUrlInput = '';

  let appUsername = '';
  let appPassword = '';
  let rememberDays = 30;
  let appAuthError = '';
  let isCheckingAuth = false;
  let showModeSwitcherOnLogin = false;

  onMount(async () => {
    serverUrlInput = $configuredServerUrlStore || '';
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      appUsername = $activeManagerUsername;
    }
    if ($isAppAuthenticated) {
      await loadPurchases(true);
    }
  });

  async function handleFirstRunSetup() {
    if (isCheckingAuth) return;
    appAuthError = '';
    isCheckingAuth = true;

    try {
      if (setupChoice === 'standalone') {
        const res = await managerAuthService.setupStandaloneAccount(
          appUsername,
          appPassword,
          rememberDays
        );
        if (!res.success) {
          appAuthError = res.error || 'خطا در ایجاد حساب محلی.';
          return;
        }
        apiClient.configure({ baseUrl: '', enabled: false });
        await settingsRepository.saveSettings({
          serverAddress: '',
          backendSyncEnabled: false
        });
        appPassword = '';
        await loadPurchases(false);
        showToast('برنامه در حالت مستقل (روی همین گوشی) راه‌اندازی شد.');
      } else {
        const cleanUrl = serverUrlInput.trim().replace(/\/+$/, '');
        if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
          appAuthError =
            'لطفاً آدرس کامل سرور را با http:// یا https:// وارد کنید (مثلاً http://94.184.6.138:3000).';
          return;
        }

        setConnectionConfig('server', cleanUrl);
        apiClient.configure({ baseUrl: cleanUrl, enabled: true });

        const res = await managerAuthService.loginAppGate(
          appUsername,
          appPassword,
          rememberDays
        );
        if (!res.success) {
          appAuthError = res.error || 'عدم موفقیت در اتصال یا احراز هویت با سرور.';
          return;
        }

        await settingsRepository.saveSettings({
          serverAddress: cleanUrl,
          backendSyncEnabled: true
        });

        appPassword = '';
        await apiClient.checkHealth();
        try {
          await acceptServerUpdate();
        } catch {
          await loadPurchases(true);
        }
        showToast('اتصال به سرور برقرار شد و اطلاعات همگام‌سازی گردید.');
      }
      showModeSwitcherOnLogin = false;
    } finally {
      isCheckingAuth = false;
    }
  }

  async function handleAppGateLogin() {
    if (isCheckingAuth) return;
    appAuthError = '';
    isCheckingAuth = true;
    try {
      if ($operatingModeStore === 'server') {
        const cleanUrl = (serverUrlInput || $configuredServerUrlStore)
          .trim()
          .replace(/\/+$/, '');
        setConnectionConfig('server', cleanUrl);
        apiClient.configure({ baseUrl: cleanUrl, enabled: true });
      } else {
        apiClient.configure({ baseUrl: '', enabled: false });
      }

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
      await loadPurchases(true);
      showToast('ورود با موفقیت انجام شد.');
    } finally {
      isCheckingAuth = false;
    }
  }
</script>

{#if !$isAppAuthenticated}
  <div class="app-auth-gate">
    <div class="panel login-panel" style="max-width: 460px; width: 100%;">
      <h1 style="font-size: 22px; margin: 0; color: var(--green);">گیله‌کُرد</h1>

      {#if ($operatingModeStore === 'unconfigured' && !$isManagerConfigured) || showModeSwitcherOnLogin}
        <p style="color: var(--muted); font-size: 12px; margin: 8px 0 16px; line-height: 1.8;">
          نحوه استفاده از برنامه در این دستگاه را انتخاب کنید (این تنظیم در هر زمان از بخش تنظیمات قابل تغییر است):
        </p>

        <div class="setting-actions" style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px;">
          <button
            type="button"
            class={setupChoice === 'standalone' ? 'secondary-btn' : 'quiet-btn'}
            style="justify-content: center; padding: 10px 8px;"
            on:click={() => {
              setupChoice = 'standalone';
              appAuthError = '';
            }}
          >
            {setupChoice === 'standalone' ? '● ' : '○ '}استفاده مستقل در گوشی
          </button>

          <button
            type="button"
            class={setupChoice === 'server' ? 'secondary-btn' : 'quiet-btn'}
            style="justify-content: center; padding: 10px 8px;"
            on:click={() => {
              setupChoice = 'server';
              appAuthError = '';
            }}
          >
            {setupChoice === 'server' ? '● ' : '○ '}اتصال به سرور آنلاین
          </button>
        </div>

        <form on:submit|preventDefault={handleFirstRunSetup} novalidate>
          {#if setupChoice === 'server'}
            <div class="field">
              <label for="setupServerUrl">آدرس سرور (IP یا دامنه)</label>
              <input
                id="setupServerUrl"
                type="url"
                dir="ltr"
                bind:value={serverUrlInput}
                placeholder="http://94.184.6.138:3000"
                style="text-align: left;"
                required
              />
            </div>
          {/if}

          <div class="field">
            <label for="setupUser">
              {setupChoice === 'standalone'
                ? 'تعیین نام کاربری مدیر (برای این گوشی)'
                : 'نام کاربری سرور'}
            </label>
            <input
              id="setupUser"
              bind:value={appUsername}
              autocomplete="username"
              placeholder="مثلاً manager"
              required
            />
          </div>

          <div class="field">
            <label for="setupPass">
              {setupChoice === 'standalone'
                ? 'تعیین رمز عبور (حداقل ۸ کاراکتر)'
                : 'رمز عبور سرور'}
            </label>
            <input
              id="setupPass"
              type="password"
              bind:value={appPassword}
              autocomplete="new-password"
              placeholder="حداقل ۸ کاراکتر"
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
              <span>به خاطر سپردن ورود به مدت ۳۰ روز</span>
            </label>
          </div>

          {#if appAuthError}
            <div class="form-error" role="alert">{appAuthError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isCheckingAuth}>
            <span>
              {isCheckingAuth
                ? 'در حال راه‌اندازی...'
                : setupChoice === 'standalone'
                  ? 'راه‌اندازی مستقل و ورود به برنامه'
                  : 'اتصال به سرور و ورود'}
            </span>
            <span class="btn-arrow">←</span>
          </button>

          {#if showModeSwitcherOnLogin}
            <button
              type="button"
              class="quiet-btn"
              style="width: 100%; margin-top: 8px; justify-content: center;"
              on:click={() => (showModeSwitcherOnLogin = false)}
            >
              بازگشت به فرم ورود
            </button>
          {/if}
        </form>
      {:else}
        <p style="color: var(--muted); font-size: 12px; margin: 8px 0 16px; line-height: 1.8;">
          {#if $operatingModeStore === 'standalone'}
            حالت فعلی: <strong>مستقل و آفلاین روی همین گوشی</strong>
          {:else}
            حالت فعلی: <strong>متصل به سرور ({$configuredServerUrlStore || 'وب'})</strong>
          {/if}
        </p>

        <form on:submit|preventDefault={handleAppGateLogin} novalidate>
          {#if $operatingModeStore === 'server'}
            <div class="field">
              <label for="appGateServerUrl">آدرس سرور</label>
              <input
                id="appGateServerUrl"
                type="url"
                dir="ltr"
                bind:value={serverUrlInput}
                placeholder="http://94.184.6.138:3000"
                style="text-align: left;"
              />
            </div>
          {/if}

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
              <span>به خاطر سپردن ورود به مدت ۳۰ روز</span>
            </label>
          </div>

          {#if appAuthError}
            <div class="form-error" role="alert">{appAuthError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isCheckingAuth}>
            <span>{isCheckingAuth ? 'در حال بررسی...' : 'ورود به برنامه'}</span>
            <span class="btn-arrow">←</span>
          </button>

          <button
            type="button"
            class="quiet-btn"
            style="width: 100%; margin-top: 10px; justify-content: center;"
            on:click={() => {
              setupChoice = $operatingModeStore === 'server' ? 'server' : 'standalone';
              showModeSwitcherOnLogin = true;
            }}
          >
            ⚙ تغییر حالت کارکرد (مستقل / تغییر آدرس سرور)
          </button>
        </form>
      {/if}
    </div>
    <Toast />
  </div>
{:else}
  <div class="app-shell">
    <Topbar />

    <main class="main-wrap">
      {#if $currentPage === 'entry'}
        <PurchaseEntryPage />
      {:else if $currentPage === 'expenses'}
        <ExpensesPage />
      {:else if $currentPage === 'revenue'}
        <RevenuePage />
      {:else if $currentPage === 'timesheets'}
        <TimesheetsPage />
      {:else}
        <ManagerPage />
      {/if}
    </main>

    <BottomNav />
    <Toast />
  </div>
{/if}
