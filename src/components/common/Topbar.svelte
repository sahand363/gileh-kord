<script lang="ts">
  import { toJalaliDate, getTodayISODate, formatNumber } from '../../utils/formatters';
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
  import { showToast } from '../../stores/toastStore';

  $: todayJalali = toJalaliDate(getTodayISODate());

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
    <span class="status-dot"></span>
    <span>حافظه محلی فعال</span>
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
