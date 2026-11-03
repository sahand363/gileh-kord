<script lang="ts">
  import { toJalaliDate, getTodayISODate } from '../../utils/formatters';
  import { navigateTo } from '../../stores/navigationStore';

  $: todayJalali = toJalaliDate(getTodayISODate());

  function handleBrandClick(event: MouseEvent) {
    event.preventDefault();
    navigateTo('entry');
  }
</script>

<header class="topbar">
  <a
    class="brand"
    href="#entry"
    on:click={handleBrandClick}
    aria-label="گیله‌کرد، صفحه ثبت خرید"
  >
    <span class="brand-mark">گ</span>
    <span>
      <strong>گیله‌کُرد</strong>
      <small>مدیریت خرید رستوران</small>
    </span>
  </a>
  <div class="topbar-meta">
    <span class="status-dot"></span>
    <span>حافظه محلی فعال</span>
    <span class="today-label">{todayJalali}</span>
  </div>
</header>
