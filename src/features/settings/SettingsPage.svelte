<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import { backupService } from '../../services/BackupService';
  import { loadPurchases, purchases } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import { formatNumber } from '../../utils/formatters';
  import { validateBackupPayload } from '../../utils/validators';
  import { MEASUREMENT_UNITS, type ApplicationSettings } from '../../models/types';

  let currentSettings: ApplicationSettings = {
    serverAddress: '',
    defaultUnit: 'کیلوگرم',
    currency: 'IRT',
    lastSyncAt: null
  };

  let fileInput: HTMLInputElement;
  let backupError = '';
  let isProcessingBackup = false;

  onMount(async () => {
    currentSettings = await settingsRepository.getSettings();
  });

  async function handleDefaultUnitChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    currentSettings.defaultUnit = target.value;
    await settingsRepository.saveSettings({ defaultUnit: target.value });
    showToast('واحد پیش‌فرض ذخیره شد.');
  }

  async function handleBackupExport() {
    if (isProcessingBackup) return;
    backupError = '';
    isProcessingBackup = true;

    try {
      const backup = await backupService.exportBackup();
      const blob = new Blob([JSON.stringify(backup, null, 2)], {
        type: 'application/json'
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gileh-kord-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('فایل پشتیبان JSON با موفقیت آماده شد.');
    } catch (err) {
      console.error(err);
      backupError = 'خطا در تهیه نسخه پشتیبان از پایگاه داده محلی.';
    } finally {
      isProcessingBackup = false;
    }
  }

  function triggerRestoreFile() {
    backupError = '';
    fileInput?.click();
  }

  async function handleRestoreFile(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    backupError = '';
    isProcessingBackup = true;

    try {
      const text = await file.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        backupError = 'فایل انتخاب‌شده یک فایل JSON معتبر نیست.';
        return;
      }

      const validation = validateBackupPayload(parsed);
      if (!validation.isValid || !validation.normalizedBackup) {
        backupError =
          validation.error ||
          'فایل انتخاب‌شده معتبر نیست و ساختار پشتیبان گیله‌کُرد را ندارد.';
        return;
      }

      const count = validation.normalizedBackup.purchases.length;
      const confirmed = window.confirm(
        `آیا از بازیابی اطلاعات مطمئن هستید؟\nاین فایل شامل ${formatNumber(count)} خرید معتبر است و جایگزین اطلاعات فعلی دستگاه خواهد شد.`
      );

      if (!confirmed) {
        return;
      }

      const restored = await backupService.restoreBackup(parsed);
      currentSettings = restored.settings;
      await loadPurchases();
      showToast('اطلاعات پشتیبان با موفقیت بازیابی شد.');
    } catch (err) {
      console.error(err);
      backupError =
        err instanceof Error
          ? err.message
          : 'خطا در بازیابی اطلاعات. داده‌های قبلی بدون تغییر حفظ شدند.';
    } finally {
      isProcessingBackup = false;
      target.value = '';
    }
  }
</script>

<section class="page active" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت برنامه</p>
      <h1 id="settingsTitle">تنظیمات</h1>
      <p class="subheading">پیکربندی برنامه، پشتیبان‌گیری محلی و وضعیت ارتباط با سرور.</p>
    </div>
  </div>

  <div class="settings-grid">
    <div class="settings-welcome">
      <div>
        <span class="eyebrow">پنل مدیریت</span>
        <h2>تنظیمات برنامه</h2>
        <p>تنظیمات محلی روی این دستگاه فعال است. بخش‌های سروری پس از استقرار بک‌اند Go فعال می‌شوند.</p>
      </div>
    </div>

    <section class="panel setting-card">
      <div class="setting-icon">⚙</div>
      <div class="setting-content">
        <h3>پیکربندی برنامه (محلی)</h3>
        <p>تنظیم واحد پیش‌فرض هنگام ثبت خرید جدید در این دستگاه.</p>
        <div class="setting-inline">
          <label for="defaultUnit">واحد پیش‌فرض</label>
          <select
            id="defaultUnit"
            value={currentSettings.defaultUnit}
            on:change={handleDefaultUnitChange}
          >
            {#each MEASUREMENT_UNITS as itemUnit}
              <option value={itemUnit}>{itemUnit}</option>
            {/each}
          </select>
        </div>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⇧</div>
      <div class="setting-content">
        <h3>پشتیبان‌گیری و بازیابی (محلی)</h3>
        <p>
          دریافت فایل پشتیبان JSON از تمام خریدهای ذخیره‌شده ({formatNumber($purchases.length)} خرید) یا بازگردانی نسخه پشتیبان معتبر.
        </p>
        <div class="setting-actions">
          <button
            class="secondary-btn"
            type="button"
            id="backupBtn"
            disabled={isProcessingBackup}
            on:click={handleBackupExport}
          >
            خروجی پشتیبان JSON
          </button>
          <button
            class="quiet-btn"
            type="button"
            id="restoreBtn"
            disabled={isProcessingBackup}
            on:click={triggerRestoreFile}
          >
            انتخاب فایل بازیابی
          </button>
          <input
            type="file"
            id="restoreFile"
            bind:this={fileInput}
            accept="application/json,.json"
            on:change={handleRestoreFile}
            hidden
          />
        </div>
        {#if backupError}
          <div class="form-error" role="alert" style="margin-top: 10px; margin-bottom: 0;">
            {backupError}
          </div>
        {/if}
        <small>
          فایل ورودی پیش از جایگزینی به‌صورت کامل اعتبارسنجی می‌شود و در صورت بروز خطا، اطلاعات قبلی حفظ خواهد شد.
        </small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⟳</div>
      <div class="setting-content">
        <h3>وضعیت ذخیره‌سازی و همگام‌سازی</h3>
        <p>وضعیت پایگاه داده محلی و ارتباط با سرور مرکزی.</p>
        <div class="sync-status">
          <span class="status-dot"></span> پایگاه داده محلی (IndexedDB) فعال است
          <small>— همگام‌سازی ابری متصل نیست</small>
        </div>
        <small>
          اطلاعات ثبت‌شده در این مرورگر باقی می‌ماند اما تا زمان راه‌اندازی سرور Go بین دستگاه‌های مختلف همگام‌سازی نمی‌شود.
        </small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⌘</div>
      <div class="setting-content">
        <h3>آدرس سرور مرکزی</h3>
        <p>نشانی سرویس بک‌اند Go برای همگام‌سازی دستگاه‌ها.</p>
        <input
          id="serverAddress"
          placeholder="https://api.example.com"
          value={currentSettings.serverAddress}
          disabled
        />
        <small>اتصال به سرور در نسخه فعلی پیاده‌سازی نشده است.</small>
      </div>
      <span class="coming-soon">به‌زودی</span>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⌑</div>
      <div class="setting-content">
        <h3>احراز هویت و دسترسی مدیر</h3>
        <p>ورود امن مدیر و مدیریت سطح دسترسی کاربران.</p>
        <small>
          احراز هویت در این فاز فرانت‌اند پیاده‌سازی نشده است و پس از اتصال به بک‌اند Go فعال خواهد شد.
        </small>
      </div>
      <span class="coming-soon">پیاده‌سازی نشده</span>
    </section>

    <div class="settings-disclaimer">
      پیکربندی واحد پیش‌فرض و پشتیبان‌گیری JSON به‌صورت کامل روی پایگاه داده محلی کار می‌کنند. احراز هویت و همگام‌سازی چنددستگاهی نیازمند بک‌اند Go در فاز بعدی است.
    </div>
  </div>
</section>
