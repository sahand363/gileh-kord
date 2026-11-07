<script lang="ts">
  import {
    toJalaliNumeric,
    toJalaliDateTime,
    getTodayISODate,
    formatNumber
  } from '../../utils/formatters';
  import { formatJalaliDayMonth } from '../../utils/jalali';
  import { navigateTo, type AppPage } from '../../stores/navigationStore';
  import {
    dashboardSummary,
    appSettings,
    pendingServerUpdate,
    acceptServerUpdate,
    dismissServerUpdatePrompt,
    clearDemoDataset
  } from '../../stores/purchaseStore';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import { runtimeState } from '../../services/pwaService';
  import { backendStatus } from '../../services/api/apiClient';
  import { showToast } from '../../stores/toastStore';
  import type { ReportingCurrency } from '../../models/types';

  $: todayISO = getTodayISODate();
  $: todayJalali = `${formatJalaliDayMonth(todayISO)} (${toJalaliNumeric(todayISO)})`;
  $: currentRepCurrency = ($appSettings.reportingCurrency || 'TOMAN') as ReportingCurrency;
  $: isConnected = $runtimeState.isOnline && $backendStatus === 'connected';

  function handleNav(page: AppPage, event?: MouseEvent) {
    event?.preventDefault();
    navigateTo(page);
  }

  async function toggleReportingCurrency() {
    const next: ReportingCurrency = currentRepCurrency === 'TOMAN' ? 'RIAL' : 'TOMAN';
    const saved = await settingsRepository.saveSettings({
      reportingCurrency: next
    });
    appSettings.set(saved);
    showToast(
      next === 'RIAL'
        ? 'واحد به ریال (×۱۰) تغییر یافت.'
        : 'واحد به تومان تغییر یافت.'
    );
  }

  async function handleAcceptServerSync() {
    await acceptServerUpdate();
    showToast('آخرین اطلاعات ثبت‌شده از سرور دریافت و جایگزین شد.');
  }

  async function handleClearDemo() {
    await clearDemoDataset();
    showToast('داده‌های نمونه آزمایشی پاک شدند.');
  }
</script>

<header class="topbar">
  <a
    class="brand"
    href="#entry"
    on:click={(e) => handleNav('entry', e)}
    aria-label="گیله‌کرد"
  >
    <strong>گیله‌کُرد</strong>
  </a>

  <div class="topbar-meta">
    <span class="today-label">{todayJalali}</span>

    <button
      type="button"
      class="currency-toggle-pill"
      on:click={toggleReportingCurrency}
    >
      <span>واحد:</span>
      <strong>{currentRepCurrency === 'RIAL' ? 'ریال' : 'تومان'}</strong>
    </button>

    <span
      class="conn-circle"
      class:online={isConnected}
      class:offline={!isConnected}
      title={isConnected ? 'متصل به سرور' : 'عدم اتصال به سرور / آفلاین'}
      aria-label={isConnected ? 'متصل به سرور' : 'عدم اتصال به سرور'}
    ></span>
  </div>
</header>

<div class="demo-banner">
  {#if $pendingServerUpdate}
    <div
      class="demo-banner-box"
      style="margin-bottom: 10px; background: #e8f3ec; border-color: #9ec5ad; color: #173f35;"
    >
      <span>
        <strong>بروزرسانی جدید روی سرور موجود است:</strong>
        آخرین تغییر: «{$pendingServerUpdate.lastAction || 'همگام‌سازی'}» توسط
        <strong>{$pendingServerUpdate.lastActor || 'کاربر'}</strong>
        {#if $pendingServerUpdate.updatedAt}
          در {toJalaliDateTime($pendingServerUpdate.updatedAt)}
        {/if}
        ({formatNumber($pendingServerUpdate.counts?.purchases || 0)} خرید،
        {formatNumber($pendingServerUpdate.counts?.revenues || 0)} روز درآمد).
        آیا مایلید آخرین اطلاعات سرور در این مرورگر بارگذاری شود؟
      </span>
      <div class="demo-banner-actions">
        <button type="button" class="secondary-btn" on:click={handleAcceptServerSync}>
          ✓ بله، دریافت آخرین اطلاعات سرور
        </button>
        <button type="button" class="quiet-btn" on:click={dismissServerUpdatePrompt}>
          فعلاً نه
        </button>
      </div>
    </div>
  {/if}

  {#if $dashboardSummary.demoCount > 0}
    <div class="demo-banner-box">
      <span>
        <strong>حالت نمایشی:</strong>
        <strong>{formatNumber($dashboardSummary.demoCount)}</strong> ردیف نمونه آزمایشی در این مرورگر وجود دارد.
      </span>
      <div class="demo-banner-actions">
        <button type="button" class="quiet-btn" on:click={handleClearDemo}>
          پاک کردن داده‌های نمونه
        </button>
      </div>
    </div>
  {/if}
</div>
