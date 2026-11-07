<script lang="ts">
  import {
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate,
    formatNumber
  } from '../../utils/formatters';
  import {
    currentPage,
    navigateTo,
    NAV_SECTIONS,
    type AppPage
  } from '../../stores/navigationStore';
  import {
    dashboardSummary,
    appSettings,
    clearDemoDataset,
    loadDemoDataset
  } from '../../stores/purchaseStore';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import { runtimeState } from '../../services/pwaService';
  import { backendStatus } from '../../services/api/apiClient';
  import { showToast } from '../../stores/toastStore';
  import type { ReportingCurrency } from '../../models/types';

  $: todayISO = getTodayISODate();
  $: todayJalali = `${toJalaliDate(todayISO)} (${toJalaliNumeric(todayISO)})`;
  $: currentRepCurrency = ($appSettings.reportingCurrency || 'TOMAN') as ReportingCurrency;

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
        ? 'واحد نمایش گزارش‌ها به ریال (۱ تومان = ۱۰ ریال) تغییر یافت.'
        : 'واحد نمایش گزارش‌ها به تومان تغییر یافت.'
    );
  }

  async function handleClearDemo() {
    await clearDemoDataset();
    showToast('داده‌های نمونه آزمایشی پاک شدند. فقط اطلاعات واقعی شما نمایش داده می‌شود.');
  }

  async function handleRestoreDemo() {
    await loadDemoDataset();
    showToast('داده‌های نمونه آزمایشی مجدداً بارگذاری شدند.');
  }
</script>

<header class="topbar">
  <a
    class="brand"
    href="#entry"
    on:click={(e) => handleNav('entry', e)}
    aria-label="گیله‌کرد، صفحه ثبت خرید"
  >
    <span class="brand-mark">گ</span>
    <span>
      <strong>{$appSettings.restaurantName || 'گیله‌کُرد'}</strong>
      <small>{$appSettings.branchName || 'مدیریت جامع خرید و تدارکات رستوران'}</small>
    </span>
  </a>

  <div class="topbar-meta">
    <button
      type="button"
      class="currency-toggle-pill"
      on:click={toggleReportingCurrency}
      title="تغییر واحد نمایش مبالغ (تومان / ریال) بدون تغییر داده‌های ذخیره‌شده"
    >
      <span>واحد نمایش:</span>
      <strong>{currentRepCurrency === 'RIAL' ? 'ریال (×۱۰)' : 'تومان'}</strong>
    </button>

    <span
      class="conn-pill"
      class:offline={!$runtimeState.isOnline}
      title={$runtimeState.swMessage}
    >
      <span class="status-dot" class:muted={!$runtimeState.isOnline}></span>
      {#if !$runtimeState.isOnline}
        <span>آفلاین | ذخیره در دستگاه</span>
      {:else if $backendStatus === 'connected'}
        <span>سرور SQLite متصل</span>
      {:else}
        <span>آنلاین | حافظه محلی فعال</span>
      {/if}
    </span>

    <span class="today-label">{todayJalali}</span>
  </div>
</header>

<nav class="section-ribbon" aria-label="بخش‌های سامانه">
  <div class="section-ribbon-inner">
    {#each NAV_SECTIONS as sec (sec.id)}
      <button
        type="button"
        class="ribbon-item"
        class:active={$currentPage === sec.id}
        on:click={() => handleNav(sec.id)}
      >
        <span class="ribbon-icon">{sec.icon}</span>
        <span>{sec.label}</span>
      </button>
    {/each}
  </div>
</nav>

<div class="demo-banner">
  {#if $dashboardSummary.demoCount > 0}
    <div class="demo-banner-box">
      <span>
        <strong>حالت نمایشی فعال:</strong>
        در حال حاضر <strong>{formatNumber($dashboardSummary.demoCount)}</strong> ردیف با برچسب
        <span class="badge-demo">نمونه آزمایشی</span> و
        <strong>{formatNumber($dashboardSummary.realCount)}</strong> خرید
        <span class="badge-real">ثبت واقعی</span> در سامانه وجود دارد.
      </span>
      <div class="demo-banner-actions">
        <button type="button" class="quiet-btn" on:click={handleClearDemo}>
          پاک کردن داده‌های نمونه
        </button>
      </div>
    </div>
  {:else if $dashboardSummary.totalPurchasesCount === 0}
    <div class="demo-banner-box">
      <span>
        پایگاه داده خالی است. می‌توانید اولین خرید واقعی خود را ثبت کنید یا داده‌های نمونه آزمایشی را بارگذاری نمایید.
      </span>
      <div class="demo-banner-actions">
        <button type="button" class="secondary-btn" on:click={handleRestoreDemo}>
          بارگذاری داده‌های نمونه آزمایشی
        </button>
      </div>
    </div>
  {/if}
</div>
