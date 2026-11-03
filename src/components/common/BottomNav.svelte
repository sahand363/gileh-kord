<script lang="ts">
  import { currentPage, navigateTo, type AppPage } from '../../stores/navigationStore';

  function handleNav(page: AppPage) {
    navigateTo(page);
  }
</script>

<nav class="bottom-nav" aria-label="ناوبری اصلی">
  <button 
    class="nav-item" 
    class:active={$currentPage === 'entry'} 
    on:click={() => handleNav('entry')}
  >
    <span class="nav-icon">＋</span>
    <span>ثبت خرید</span>
  </button>
  <button 
    class="nav-item" 
    class:active={$currentPage === 'history'} 
    on:click={() => handleNav('history')}
  >
    <span class="nav-icon">▤</span>
    <span>خریدها</span>
  </button>
  <button 
    class="nav-item" 
    class:active={$currentPage === 'settings'} 
    on:click={() => handleNav('settings')}
  >
    <span class="nav-icon">⚙</span>
    <span>تنظیمات</span>
  </button>
</nav>
