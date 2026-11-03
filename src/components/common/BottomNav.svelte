<script lang="ts">
  import {
    currentPage,
    navigateTo,
    NAV_SECTIONS,
    type AppPage
  } from '../../stores/navigationStore';

  let isMoreOpen = false;

  const primaryIds: AppPage[] = ['entry', 'history', 'employees', 'timesheets'];
  $: isSecondaryActive = !primaryIds.includes($currentPage);

  function selectPage(page: AppPage) {
    isMoreOpen = false;
    navigateTo(page);
  }
</script>

{#if isMoreOpen}
  <div
    class="more-sheet-backdrop"
    role="presentation"
    on:click={() => (isMoreOpen = false)}
  ></div>
  <div class="more-sheet" role="dialog" aria-label="سایر بخش‌های گیله‌کُرد">
    <div class="section-heading" style="margin-bottom: 10px;">
      <h2>همه بخش‌های سامانه</h2>
      <button type="button" class="quiet-btn" on:click={() => (isMoreOpen = false)}>
        بستن
      </button>
    </div>
    <div class="more-sheet-grid">
      {#each NAV_SECTIONS as sec (sec.id)}
        <button
          type="button"
          class="quick-nav-btn"
          on:click={() => selectPage(sec.id)}
        >
          <span class="quick-nav-icon">{sec.icon}</span>
          <div>
            <strong style="font-size: 11px; display: block;">{sec.label}</strong>
          </div>
        </button>
      {/each}
    </div>
  </div>
{/if}

<nav class="bottom-nav" aria-label="ناوبری موبایل">
  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'entry'}
    on:click={() => selectPage('entry')}
  >
    <span class="nav-icon">＋</span>
    <span>ثبت خرید</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'history'}
    on:click={() => selectPage('history')}
  >
    <span class="nav-icon">▤</span>
    <span>خریدها</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'employees'}
    on:click={() => selectPage('employees')}
  >
    <span class="nav-icon">♟</span>
    <span>کارکنان</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'timesheets'}
    on:click={() => selectPage('timesheets')}
  >
    <span class="nav-icon">◷</span>
    <span>تایم‌شیت</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={isSecondaryActive || isMoreOpen}
    on:click={() => (isMoreOpen = !isMoreOpen)}
  >
    <span class="nav-icon">☰</span>
    <span>سایر بخش‌ها</span>
  </button>
</nav>
