<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import {
    appSettings,
    loadPurchases,
    syncLocalStateToServer,
    checkForServerUpdates
  } from '../../stores/purchaseStore';
  import {
    managerAuthService,
    activeManagerUsername,
    operatingModeStore,
    configuredServerUrlStore,
    setConnectionConfig
  } from '../../services/ManagerAuthService';
  import { apiClient, backendStatus } from '../../services/api/apiClient';
  import { showToast } from '../../stores/toastStore';
  import { MEASUREMENT_UNITS, type ReportingCurrency } from '../../models/types';

  let restaurantName = 'گیله‌کُرد';
  let defaultUnit = 'کیلوگرم';
  let reportingCurrency: ReportingCurrency = 'TOMAN';
  let showDemoBadges = true;

  // Connection Mode & Server Address Settings
  let modeChoice: 'standalone' | 'server' = 'standalone';
  let serverAddressInput = '';
  let connectionError = '';
  let isTestingServer = false;

  // Password Change
  let currentPassword = '';
  let newUsername = '';
  let newPassword = '';
  let passError = '';

  onMount(async () => {
    const s = await settingsRepository.getSettings();
    restaurantName = s.restaurantName || 'گیله‌کُرد';
    defaultUnit = s.defaultUnit || 'کیلوگرم';
    reportingCurrency = (s.reportingCurrency || 'TOMAN') as ReportingCurrency;
    showDemoBadges = s.showDemoBadges;

    modeChoice = $operatingModeStore === 'server' ? 'server' : 'standalone';
    serverAddressInput = $configuredServerUrlStore || s.serverAddress || '';
    newUsername = $activeManagerUsername || '';
  });

  async function handleSaveConnectionSettings() {
    connectionError = '';

    if (modeChoice === 'standalone') {
      setConnectionConfig('standalone', '');
      apiClient.configure({ baseUrl: '', enabled: false });
      const saved = await settingsRepository.saveSettings({
        serverAddress: '',
        backendSyncEnabled: false
      });
      appSettings.set(saved);
      showToast('برنامه روی «حالت مستقل در همین گوشی» تنظیم شد.');
      return;
    }

    const cleanUrl = serverAddressInput.trim().replace(/\/+$/, '');
    if (!cleanUrl || !/^https?:\/\//i.test(cleanUrl)) {
      connectionError =
        'لطفاً آدرس کامل سرور را همراه با http:// یا https:// وارد کنید (مثلاً http://94.184.6.138:3000).';
      return;
    }

    isTestingServer = true;
    try {
      setConnectionConfig('server', cleanUrl);
      apiClient.configure({ baseUrl: cleanUrl, enabled: true });

      const healthy = await apiClient.checkHealth();
      const saved = await settingsRepository.saveSettings({
        serverAddress: cleanUrl,
        backendSyncEnabled: true
      });
      appSettings.set(saved);

      if (healthy) {
        void checkForServerUpdates();
        showToast('آدرس سرور ذخیره شد و اتصال با موفقیت برقرار گردید.');
      } else {
        showToast('آدرس سرور ذخیره شد، اما سرور در حال حاضر پاسخ نداد.');
      }
    } finally {
      isTestingServer = false;
    }
  }

  async function handleSaveGeneralSettings() {
    const saved = await settingsRepository.saveSettings({
      restaurantName: restaurantName.trim() || 'گیله‌کُرد',
      defaultUnit,
      reportingCurrency,
      showDemoBadges
    });
    appSettings.set(saved);
    await loadPurchases(false);
    void syncLocalStateToServer('بروزرسانی تنظیمات کافه');
    showToast('تنظیمات کافه با موفقیت ذخیره شد.');
  }

  async function handleChangeLocalCredentials() {
    passError = '';
    const res = await managerAuthService.changePassword(
      currentPassword,
      newPassword,
      newUsername
    );
    if (!res.success) {
      passError = res.error || 'خطا در تغییر رمز عبور.';
      return;
    }
    currentPassword = '';
    newPassword = '';
    showToast('نام کاربری و رمز عبور این دستگاه با موفقیت بروزرسانی شد.');
  }

  function handleFullDeviceLogout() {
    if (
      !window.confirm(
        'آیا مایلید از حساب کاربری این دستگاه خارج شوید؟'
      )
    ) {
      return;
    }
    managerAuthService.logoutWholeApp();
    showToast('خروج از حساب کاربری انجام شد.');
  }
</script>

<section class="page active" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">پیکربندی برنامه، آدرس سرور و نشست کاربری</p>
      <h1 id="settingsTitle">تنظیمات</h1>
    </div>
  </div>

  <div class="settings-grid">
    <!-- 1. Server Address & Standalone/Online Mode Configuration -->
    <section class="panel setting-card">
      <div class="setting-icon">⇄</div>
      <div class="setting-content">
        <h3>حالت کارکرد برنامه و آدرس سرور (مستقل / آنلاین)</h3>
        <p>
          می‌توانید برنامه را به صورت کاملاً مستقل روی همین گوشی استفاده کنید یا آدرس سرور کافه را وارد نمایید تا داده‌ها با سرور همگام شوند.
        </p>

        <div class="setting-actions" style="margin-bottom: 14px;">
          <button
            type="button"
            class={modeChoice === 'standalone' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => {
              modeChoice = 'standalone';
              connectionError = '';
            }}
          >
            {modeChoice === 'standalone' ? '● ' : '○ '}حالت مستقل (ذخیره فقط در همین گوشی)
          </button>

          <button
            type="button"
            class={modeChoice === 'server' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => {
              modeChoice = 'server';
              connectionError = '';
            }}
          >
            {modeChoice === 'server' ? '● ' : '○ '}متصل به سرور آنلاین
          </button>
        </div>

        <form on:submit|preventDefault={handleSaveConnectionSettings} novalidate>
          {#if modeChoice === 'server'}
            <div class="field">
              <label for="setServerUrl">آدرس سرور (IP و پورت یا دامنه)</label>
              <input
                id="setServerUrl"
                type="url"
                dir="ltr"
                bind:value={serverAddressInput}
                placeholder="http://94.184.6.138:3000"
                style="text-align: left;"
                required
              />
              <small class="field-hint">
                وضعیت فعلی سرور:
                <strong>
                  {$backendStatus === 'connected' ? 'متصل (سبز)' : 'عدم اتصال'}
                </strong>
              </small>
            </div>
          {/if}

          {#if connectionError}
            <div class="form-error" role="alert">{connectionError}</div>
          {/if}

          <button
            type="submit"
            class="primary-btn"
            style="max-width: 280px;"
            disabled={isTestingServer}
          >
            <span>
              {isTestingServer
                ? 'در حال بررسی سرور...'
                : modeChoice === 'standalone'
                  ? 'ذخیره حالت مستقل'
                  : 'ذخیره آدرس و اتصال به سرور'}
            </span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      </div>
    </section>

    <!-- 2. General Cafe Settings -->
    <section class="panel setting-card">
      <div class="setting-icon">⚙</div>
      <div class="setting-content">
        <h3>مشخصات کافه و واحدهای پیش‌فرض</h3>
        <p>تنظیم نام مجموعه، واحد پیش‌فرض ثبت خرید و واحد نمایش مبالغ.</p>

        <form on:submit|preventDefault={handleSaveGeneralSettings} novalidate>
          <div class="field-row">
            <div class="field">
              <label for="setCafeName">نام مجموعه</label>
              <input id="setCafeName" bind:value={restaurantName} placeholder="گیله‌کُرد" />
            </div>

            <div class="field">
              <label for="setDefUnit">واحد پیش‌فرض خرید</label>
              <select id="setDefUnit" bind:value={defaultUnit}>
                {#each MEASUREMENT_UNITS as u}
                  <option value={u}>{u}</option>
                {/each}
              </select>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="setRepCurr">واحد پول گزارش‌ها</label>
              <select id="setRepCurr" bind:value={reportingCurrency}>
                <option value="TOMAN">تومان (پیش‌فرض)</option>
                <option value="RIAL">ریال (۱ تومان = ۱۰ ریال)</option>
              </select>
            </div>

            <div class="field" style="display: flex; align-items: center; padding-top: 22px;">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer; margin: 0;">
                <input
                  type="checkbox"
                  bind:checked={showDemoBadges}
                  style="width: 18px; height: 18px; min-height: 18px;"
                />
                <span>نمایش برچسب «ثبت واقعی» روی فاکتورها</span>
              </label>
            </div>
          </div>

          <button type="submit" class="primary-btn" style="max-width: 240px;">
            <span>ذخیره تنظیمات</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      </div>
    </section>

    <!-- 3. Change Manager Username & Password -->
    <section class="panel setting-card">
      <div class="setting-icon">🔑</div>
      <div class="setting-content">
        <h3>تغییر نام کاربری و رمز عبور در این دستگاه</h3>
        <p>
          در حالت مستقل، این رمز مستقیماً رمز ورود و مدیریت شما روی گوشی است. در حالت سرور، کش آفلاین را بروز می‌کند.
        </p>

        <form on:submit|preventDefault={handleChangeLocalCredentials} novalidate>
          <div class="field-row">
            <div class="field">
              <label for="setMgrUser">نام کاربری</label>
              <input id="setMgrUser" bind:value={newUsername} autocomplete="username" />
            </div>
            <div class="field">
              <label for="setCurPass">رمز عبور فعلی</label>
              <input
                id="setCurPass"
                type="password"
                bind:value={currentPassword}
                autocomplete="current-password"
              />
            </div>
          </div>

          <div class="field">
            <label for="setNewPass">رمز عبور جدید (حداقل ۸ کاراکتر)</label>
            <input
              id="setNewPass"
              type="password"
              bind:value={newPassword}
              autocomplete="new-password"
            />
          </div>

          {#if passError}
            <div class="form-error" role="alert">{passError}</div>
          {/if}

          <button type="submit" class="secondary-btn">
            ذخیره رمز عبور جدید
          </button>
        </form>
      </div>
    </section>

    <!-- 4. Active Device Session Logout -->
    <section class="panel setting-card">
      <div class="setting-icon">⌑</div>
      <div class="setting-content">
        <h3>نشست فعال در این دستگاه</h3>
        <p>
          برای خروج از حساب کاربری فعلی و بازگشت به صفحه ورود اولیه، از دکمه زیر استفاده کنید.
        </p>
        <div class="setting-actions">
          <button type="button" class="quiet-btn" on:click={handleFullDeviceLogout}>
            خروج کامل از حساب در این دستگاه
          </button>
        </div>
      </div>
    </section>
  </div>
</section>
