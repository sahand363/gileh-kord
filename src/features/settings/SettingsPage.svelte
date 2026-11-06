<script lang="ts">
  import { onMount } from 'svelte';
  import {
    DEFAULT_SETTINGS,
    settingsRepository
  } from '../../services/repositories/SettingsRepository';
  import { appSettings } from '../../stores/purchaseStore';
  import { runtimeState } from '../../services/pwaService';
  import {
    managerAuthService,
    isManagerUnlocked
  } from '../../services/ManagerAuthService';
  import { activeManagerTab, navigateTo } from '../../stores/navigationStore';
  import { showToast } from '../../stores/toastStore';
  import { MEASUREMENT_UNITS, type ApplicationSettings } from '../../models/types';

  let currentSettings: ApplicationSettings = { ...DEFAULT_SETTINGS };

  let masterUsername = '';
  let masterPassword = '';
  let loginError = '';

  onMount(async () => {
    currentSettings = await settingsRepository.getSettings();
    appSettings.set(currentSettings);
  });

  async function saveConfig() {
    const saved = await settingsRepository.saveSettings(currentSettings);
    currentSettings = saved;
    appSettings.set(saved);
    showToast('تنظیمات ذخیره شد.');
  }

  async function handleBottomManagerAccess() {
    loginError = '';
    if ($isManagerUnlocked) {
      activeManagerTab.set('overview');
      navigateTo('manager');
      return;
    }
    const res = await managerAuthService.login(masterUsername, masterPassword);
    if (!res.success) {
      loginError = res.error || 'نام کاربری یا رمز عبور نادرست است.';
      return;
    }
    masterPassword = '';
    activeManagerTab.set('overview');
    navigateTo('manager');
    showToast('بخش مدیریت باز شد.');
  }
</script>

<section class="page active" aria-labelledby="settingsTitle">
  <div class="page-heading">
    <h1 id="settingsTitle">تنظیمات</h1>
  </div>

  <div class="settings-grid">
    <section class="panel setting-card">
      <div class="setting-icon">⚙</div>
      <div class="setting-content">
        <h3>مشخصات رستوران و واحد پیش‌فرض</h3>
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
              ? '✓ نمایش برچسب تفکیک «نمونه آزمایشی / ثبت واقعی» فعال'
              : 'نمایش برچسب تفکیک غیرفعال'}
          </button>
        </div>
      </div>
    </section>

    <section class="panel setting-card">
      <div class="setting-icon">⟳</div>
      <div class="setting-content">
        <h3>وضعیت شبکه و حافظه محلی</h3>
        <div class="sync-status">
          <span class="status-dot" class:muted={!$runtimeState.isOnline}></span>
          <span>{$runtimeState.isOnline ? 'آنلاین — حافظه محلی فعال' : 'آفلاین — ذخیره در دستگاه فعال'}</span>
        </div>
      </div>
    </section>

    <!-- Bottom of Settings Tab: Input Link Leading to the Management Section -->
    <section class="panel setting-card" style="border-color: var(--green-2); background: #f8fbf9;">
      <div class="setting-icon">⌑</div>
      <div class="setting-content">
        <h3>ورود به بخش مدیریت (با نام کاربری و رمز عبور SSH)</h3>
        {#if $isManagerUnlocked}
          <p>دسترسی مدیریت فعال است.</p>
          <button
            type="button"
            class="primary-btn"
            style="max-width: 280px;"
            on:click={() => {
              activeManagerTab.set('overview');
              navigateTo('manager');
            }}
          >
            <span>مشاهده بخش مدیریت</span>
            <span class="btn-arrow">←</span>
          </button>
        {:else}
          <form on:submit|preventDefault={handleBottomManagerAccess} novalidate>
            <div class="field-row" style="max-width: 520px; margin-bottom: 10px;">
              <div class="field" style="margin-bottom: 0;">
                <label for="settingsMgrUser">نام کاربری مستر</label>
                <input
                  id="settingsMgrUser"
                  bind:value={masterUsername}
                  placeholder="نام کاربری SSH"
                  required
                />
              </div>
              <div class="field" style="margin-bottom: 0;">
                <label for="settingsMgrPass">رمز عبور مستر</label>
                <input
                  id="settingsMgrPass"
                  type="password"
                  bind:value={masterPassword}
                  placeholder="رمز عبور SSH"
                  required
                />
              </div>
            </div>
            {#if loginError}
              <div class="form-error" role="alert">{loginError}</div>
            {/if}
            <button type="submit" class="primary-btn" style="max-width: 260px;">
              <span>ورود به بخش مدیریت</span>
              <span class="btn-arrow">←</span>
            </button>
          </form>
        {/if}
      </div>
    </section>
  </div>
</section>
