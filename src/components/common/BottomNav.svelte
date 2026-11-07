<script lang="ts">
  import {
    currentPage,
    navigateTo,
    type AppPage
  } from '../../stores/navigationStore';

  function selectPage(page: AppPage) {
    navigateTo(page);
  }
</script>

<nav class="bottom-nav" aria-label="ناوبری موبایل">
  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'dashboard'}
    on:click={() => selectPage('dashboard')}
  >
    <span class="nav-icon">⊞</span>
    <span>پیشخوان</span>
  </button>

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
    class:active={$currentPage === 'timesheets'}
    on:click={() => selectPage('timesheets')}
  >
    <span class="nav-icon">◷</span>
    <span>تایم‌شیت</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'revenue'}
    on:click={() => selectPage('revenue')}
  >
    <span class="nav-icon">₿</span>
    <span>درآمد</span>
  </button>

  <button
    type="button"
    class="nav-item"
    class:active={$currentPage === 'manager'}
    on:click={() => selectPage('manager')}
  >
    <span class="nav-icon">⌑</span>
    <span>مدیریت</span>
  </button>
</nav>
