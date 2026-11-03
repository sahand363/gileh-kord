<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    settingsRepository
  } from '../../services/repositories/SettingsRepository';
  import { appSettings } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import { showToast } from '../../stores/toastStore';
  import { MEASUREMENT_UNITS, type ApplicationSettings } from '../../models/types';

  let currentSettings: ApplicationSettings = { ...DEFAULT_SETTINGS };

  onMount(async () => {
    currentSettings = await settingsRepository.getSettings();
    appSettings.set(currentSettings);
  });

  async function saveConfig() {
    const saved = await settingsRepository.saveSettings(currentSettings);
    currentSettings = saved;
    appSettings.set(saved);
    showToast('تنظیمات برنامه در حافظه محلی ذخیره شد.');
  }
</script>

<section class="page active" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت برنامه</p>
      <h1 id="settingsTitle">تنظیمات</h1>
      <p class="subheading">پیکربندی مشخصات رستوران، واحد پیش‌فرض ثبت خرید و وضعیت ارتباط با سرور.</p>
    </div>
  </div>

  <div class="settings-grid">
    <div class="settings-welcome">
      <div>
        <span class="eyebrow">پنل مدیریت</span>
        <h2>پیکربندی سامانه گیله‌کُرد</h2>
        <p>تنظیمات محلی روی این مرورگر فعال است. بخش‌های همگام‌سازی ابری در فاز بک‌اند Go فعال می‌شوند.</p>
      </div>
      <button type="button" class="secondary-btn" on:click={() => navigateTo('backup')}>
        ⇧ مدیریت پشتیبان‌گیری و داده‌های نمونه
      </button>
    </div>

    <section class="panel setting-card">
      <div class="setting-icon">⚙</div>
      <div class="setting-content">
        <h3>مشخصات رستوران و واحد پیش‌فرض</h3>
        <p>تنظیم نام مجموعه، شعبه و واحد اندازه‌گیری پیش‌فرض هنگام ثبت خرید جدید.</p>
        <div class="field-row" style="max-width: 560px; margin-bottom: 12px;">
          <div class="field" style="margin-bottom: 0;">
            <label for="restName">نام رستوران</label>
            <input id="restName" bind:value={currentSettings.restaurantName} on:change={saveConfig} />
          </div>
          <div class="field" style="margin-bottom: 0;">
            <label for="defaultUnit">واحد پیش‌فرض خرید</label>
            <select
              id="defaultUnit"
              bind:value={currentSettings.defaultUnit}
              on:change={saveConfig}
            >
              {#each MEASUREMENT_UNITS as itemUnit}
                <option value={itemUnit}>{itemUnit}</option>
              {/each}
            </select>
          </div>
        </div>
        <div class="setting-actions">
          <button
            type="button"
            class={currentSettings.showDemoBadges ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => {
              currentSettings.showDemoBadges = !currentSettings.showDemoBadges;
              saveConfig();
            }}
          >
            {currentSettings.showDemoBadges
              ? '✓ نمایش برچسب تفکیک «نمونه آزمایشی / ثبت واقعی» فعال است'
              : 'نمایش برچسب تفکیک غیرفعال است'}
          </button>
        </div>
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
          داده‌های شما پس از بستن مرورگر و رفرش صفحه حفظ می‌شوند، اما تا زمان راه‌اندازی سرور Go بین دستگاه‌های مختلف همگام‌سازی نمی‌شوند.
        </small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⌘</div>
      <div class="setting-content">
        <h3>آدرس سرور مرکزی (فاز بک‌اند Go)</h3>
        <p>نشانی سرویس REST API برای همگام‌سازی چنددستگاهی.</p>
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
          برای جلوگیری از امنیت کاذب در سمت کلاینت، هیچ رمز عبور ساختگی در فرانت‌اند قرار داده نشده است. احراز هویت واقعی در بک‌اند Go پیاده‌سازی خواهد شد.
        </small>
      </div>
      <span class="coming-soon">پیاده‌سازی نشده</span>
    </section>
  </div>
</section>
