<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    settingsRepository
  } from '../../services/repositories/SettingsRepository';
  import { appSettings } from '../../stores/purchaseStore';
  import { runtimeState } from '../../services/pwaService';
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
      <p class="eyebrow">مدیریت برنامه و بررسی سازگاری شبکه</p>
      <h1 id="settingsTitle">تنظیمات</h1>
      <p class="subheading">پیکربندی مشخصات رستوران، واحد پیش‌فرض ثبت خرید و وضعیت دسترسی HTTP / HTTPS و آفلاین.</p>
    </div>
  </div>

  <div class="settings-grid">
    <div class="settings-welcome">
      <div>
        <span class="eyebrow">پنل مدیریت</span>
        <h2>پیکربندی سامانه گیله‌کُرد</h2>
        <p>تنظیمات محلی روی این مرورگر فعال است و روی هر دو حالت HTTP IP و دامنه HTTPS کار می‌کند.</p>
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
        <h3>وضعیت شبکه، پروتکل و کش آفلاین</h3>
        <p>بررسی خودکار امکانات مرورگر بر اساس نحوه اتصال فعلی (HTTP IP یا دامنه HTTPS).</p>
        <div class="sync-status">
          <span class="status-dot" class:muted={!$runtimeState.isOnline}></span>
          <strong>وضعیت اینترنت:</strong>
          <span>{$runtimeState.isOnline ? 'آنلاین' : 'آفلاین (ذخیره‌سازی محلی فعال)'}</span>
        </div>
        <div class="sync-status" style="margin-top: 6px;">
          <span class="status-dot"></span>
          <strong>حالت دسترسی فعلی:</strong>
          <span>
            {#if $runtimeState.accessMode === 'https-domain'}
              دامنه امن HTTPS (پشتیبانی کامل از نصب PWA و کش آفلاین App Shell)
            {:else if $runtimeState.accessMode === 'http-ip'}
              آدرس مستقیم HTTP IP (پایگاه داده IndexedDB و ثبت خرید کاملاً فعال؛ کش Service Worker توسط مرورگرها محدود به HTTPS است)
            {:else}
              محیط محلی (Localhost)
            {/if}
          </span>
        </div>
        <small>{$runtimeState.swMessage}</small>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⌘</div>
      <div class="setting-content">
        <h3>دامنه پیشنهادی و آدرس سرور</h3>
        <p>دامنه: <strong>https://gilehkord.modesehramiz.ir</strong> (اختیاری — بدون مسدودسازی دسترسی HTTP IP).</p>
        <input
          id="serverAddress"
          placeholder="https://gilehkord.modesehramiz.ir"
          value={currentSettings.serverAddress}
          disabled
        />
        <small>گواهی SSL رایگان Let's Encrypt از طریق منوی مدیریت SSH (گزینه 8) قابل فعال‌سازی است.</small>
      </div>
      <span class="coming-soon">اختیاری</span>
    </section>
  </div>
</section>
