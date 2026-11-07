<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import {
    appSettings,
    loadPurchases,
    syncLocalStateToServer
  } from '../../stores/purchaseStore';
  import {
    managerAuthService,
    activeManagerUsername
  } from '../../services/ManagerAuthService';
  import { showToast } from '../../stores/toastStore';
  import { MEASUREMENT_UNITS, type ReportingCurrency } from '../../models/types';

  let restaurantName = 'گیله‌کُرد';
  let defaultUnit = 'کیلوگرم';
  let reportingCurrency: ReportingCurrency = 'TOMAN';
  let showDemoBadges = true;

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
    newUsername = $activeManagerUsername || 'admin';
  });

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
    showToast('رمز عبور محلی بروزرسانی شد (برای تغییر رمز اصلی سرور از منوی sudo gk گزینه ۸ استفاده کنید).');
  }

  function handleFullDeviceLogout() {
    if (!window.confirm('آیا مایلید از حساب کاربری این دستگاه خارج شوید و کوکی ۳۰ روزه پاک شود؟')) {
      return;
    }
    managerAuthService.logoutWholeApp();
    showToast('خروج کامل از دستگاه انجام شد.');
  }
</script>

<section class="page active" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">پیکربندی عمومی و نشست کاربری</p>
      <h1 id="settingsTitle">تنظیمات</h1>
    </div>
  </div>

  <div class="settings-grid">
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

    <section class="panel setting-card">
      <div class="setting-icon">🔑</div>
      <div class="setting-content">
        <h3>بروزرسانی رمز عبور کش آفلاین</h3>
        <p>
          توجه: برای افزودن مدیر جدید یا تغییر رمز اصلی سرور، در ترمینال SSH دستور <code>sudo gk</code> را زده و <strong>گزینه ۸</strong> را انتخاب کنید.
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
            <label for="setNewPass">رمز عبور جدید</label>
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
            بروزرسانی رمز عبور محلی
          </button>
        </form>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⌑</div>
      <div class="setting-content">
        <h3>نشست فعال در این دستگاه</h3>
        <p>
          در صورتی که می‌خواهید کوکی ۳۰ روزه ورود اول در این مرورگر پاک شود و برنامه به صفحه ورود اولیه برگردد، از دکمه زیر استفاده کنید.
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
