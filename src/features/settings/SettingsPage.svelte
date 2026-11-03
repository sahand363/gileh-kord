<script lang="ts">
  import { onMount } from 'svelte';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import { purchaseRepository } from '../../services/repositories/PurchaseRepository';
  import { productRepository } from '../../services/repositories/ProductRepository';
  import { loadPurchases } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import { validateBackupData } from '../../utils/validators';
  import type { ApplicationSettings, BackupData } from '../../models/types';

  let currentSettings: ApplicationSettings = {
    serverAddress: '',
    defaultUnit: 'کیلوگرم',
    currency: 'IRT',
    lastSyncAt: null
  };

  let fileInput: HTMLInputElement;
  let isDevSettingsRevealed = true; // No fake security barrier; structured cleanly for future Go backend

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
    try {
      const purchasesList = await purchaseRepository.getAll();
      const productsList = await productRepository.getAll();
      const settings = await settingsRepository.getSettings();

      const backup: BackupData = {
        version: 1,
        exportedAt: new Date().toISOString(),
        purchases: purchasesList,
        products: productsList,
        settings
      };

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gileh-kord-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('فایل پشتیبان JSON با موفقیت دریافت شد.');
    } catch (err) {
      console.error(err);
      showToast('خطا در دریافت خروجی پشتیبان.');
    }
  }

  function triggerRestoreFile() {
    fileInput.click();
  }

  async function handleRestoreFile(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const parsed = JSON.parse(text);

      if (!validateBackupData(parsed)) {
        alert('فایل انتخاب‌شده معتبر نیست و ساختار پشتیبان گیله‌کُرد را ندارد.');
        target.value = '';
        return;
      }

      const confirmed = window.confirm(
        `آیا مطمئن هستید که می‌خواهید اطلاعات را بازیابی کنید؟\nاین فایل شامل ${parsed.purchases.length} خرید است. داده‌های کنونی با اطلاعات فایل جایگزین خواهند شد.`
      );

      if (!confirmed) {
        target.value = '';
        return;
      }

      await purchaseRepository.replaceAll(parsed.purchases);
      if (parsed.products && Array.isArray(parsed.products)) {
        await productRepository.replaceAll(parsed.products);
      }
      if (parsed.settings) {
        await settingsRepository.saveSettings(parsed.settings);
        currentSettings = parsed.settings;
      }

      await loadPurchases();
      showToast('اطلاعات با موفقیت بازیابی شد.');
    } catch (err) {
      console.error(err);
      alert('خطا در خواندن یا پردازش فایل پشتیبان JSON.');
    } finally {
      target.value = '';
    }
  }
</script>

<section class="page" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت برنامه</p>
      <h1 id="settingsTitle">تنظیمات</h1>
      <p class="subheading">پیکربندی پایگاه داده محلی و ماژول‌های سیستم.</p>
    </div>
  </div>

  <div class="settings-grid">
    <div class="settings-welcome">
      <div>
        <span class="eyebrow">فضای ابری و سرور</span>
        <h2>تنظیمات اتصال</h2>
        <p>اتصال به سرور Go و احراز هویت متمرکز در فاز توسعه بک‌اند فعال خواهد شد.</p>
      </div>
    </div>

    <section class="panel setting-card">
      <div class="setting-icon">⌘</div>
      <div class="setting-content">
        <h3>آدرس سرور</h3>
        <p>نشانی سرور مرکزی Go برای همگام‌سازی بین چند دستگاه.</p>
        <input 
          placeholder="https://api.example.com" 
          value={currentSettings.serverAddress} 
          disabled 
        />
        <small>اتصال سرور در فاز بعد با پیاده‌سازی بک‌اند Go فعال می‌شود.</small>
      </div>
      <span class="coming-soon">به‌زودی</span>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⚙</div>
      <div class="setting-content">
        <h3>پیکربندی برنامه</h3>
        <p>تنظیم واحدهای پیش‌فرض و پارامترهای پایه‌ای ثبت خرید.</p>
        <div class="setting-inline">
          <label for="defaultUnit">واحد پیش‌فرض</label>
          <select id="defaultUnit" value={currentSettings.defaultUnit} on:change={handleDefaultUnitChange}>
            <option value="کیلوگرم">کیلوگرم</option>
            <option value="عدد">عدد</option>
            <option value="لیتر">لیتر</option>
            <option value="بسته">بسته</option>
          </select>
        </div>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⇧</div>
      <div class="setting-content">
        <h3>پشتیبان‌گیری و بازیابی محلی</h3>
        <p>خروجی گرفتن از تمام خریدهای محلی و بازگردانی نسخه‌های قبلی.</p>
        <div class="setting-actions">
          <button class="secondary-btn" type="button" on:click={handleBackupExport}>
            خروجی کامل JSON
          </button>
          <button class="quiet-btn" type="button" on:click={triggerRestoreFile}>
            بازیابی از فایل JSON
          </button>
          <input 
            type="file" 
            bind:this={fileInput} 
            accept="application/json" 
            on:change={handleRestoreFile} 
            hidden 
          />
        </div>
        <small>فایل‌های پشتیبان اعتبارسنجی شده و قبل از جایگزینی داده‌ها تأییدیه کاربر دریافت می‌شود.</small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⟳</div>
      <div class="setting-content">
        <h3>وضعیت همگام‌سازی</h3>
        <p>وضعیت ارتباط با سرور مرکزی.</p>
        <div class="sync-status">
          <span class="status-dot muted"></span> متصل نیست 
          <small>پایگاه داده IndexedDB محلی فعال است</small>
        </div>
      </div>
    </section>

    <div class="settings-disclaimer">
      توجه: احراز هویت و ذخیره‌سازی ابری چندکاربره نیازمند استقرار سرویس بک‌اند Go است. اطلاعات فعلی در مرورگر جاری نگهداری می‌شود.
    </div>
  </div>
</section>
