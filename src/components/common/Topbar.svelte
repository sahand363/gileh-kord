<script lang="ts">
  import { toJalaliDate, toJalaliNumeric, getTodayISODate, formatNumber } from '../../utils/formatters';
  import {
    currentPage,
    navigateTo,
    NAV_SECTIONS,
    type AppPage
  } from '../../stores/navigationStore';
  import {
    dashboardSummary,
    clearDemoDataset,
    loadDemoDataset
  } from '../../stores/purchaseStore';
  import { runtimeState } from '../../services/pwaService';
  import { showToast } from '../../stores/toastStore';

  $: todayISO = getTodayISODate();
  $: todayJalali = `${toJalaliDate(todayISO)} (${toJalaliNumeric(todayISO)})`;

  function handleNav(page: AppPage, event?: MouseEvent) {
    event?.preventDefault();
    navigateTo(page);
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
      <strong>گیله‌کُرد</strong>
      <small>مدیریت جامع خرید و تدارکات رستوران</small>
    </span>
  </a>

  <div class="topbar-meta">
    <span
      class="conn-pill"
      class:offline={!$runtimeState.isOnline}
      title={$runtimeState.swMessage}
    >
      <span class="status-dot" class:muted={!$runtimeState.isOnline}></span>
      {#if $runtimeState.isOnline}
        <span>آنلاین | حافظه محلی فعال</span>
      {:else}
        <span>آفلاین | ذخیره در دستگاه فعال</span>
      {/if}
    </span>

    <span
      class="conn-pill"
      title={$runtimeState.swMessage}
    >
      {#if $runtimeState.swStatus === 'active'}
        <span>کش آفلاین فعال (HTTPS)</span>
      {:else if $runtimeState.accessMode === 'http-ip'}
        <span>حالت HTTP IP</span>
      {:else}
        <span>IndexedDB فعال</span>
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
  {#if !$runtimeState.isOnline}
    <div class="demo-banner-box" style="margin-bottom: 8px; background: #eef5f0; border-color: #cfe0d4; color: #173d32;">
      <span>
        <strong>وضعیت آفلاین (قطع اینترنت):</strong>
        شما به اینترنت متصل نیستید، اما ثبت خرید و مشاهده اطلاعات از طریق پایگاه داده محلی دستگاه (IndexedDB) بدون محدودیت کار می‌کند.
      </span>
    </div>
  {/if}

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
        پایگاه داده خالی است. می‌توانید اولین خرید واقعی خود را ثبت کنید یا داده‌های نمونه آزمایشی را برای مشاهده کامل صفحات بارگذاری نمایید.
      </span>
      <div class="demo-banner-actions">
        <button type="button" class="secondary-btn" on:click={handleRestoreDemo}>
          بارگذاری داده‌های نمونه آزمایشی
        </button>
      </div>
    </div>
  {/if}
</div>
