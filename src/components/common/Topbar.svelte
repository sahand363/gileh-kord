<script lang="ts">
  import { toJalaliDate, getTodayISODate } from '../../utils/formatters';
  import { navigateTo } from '../../stores/navigationStore';

  const todayJalali = toJalaliDate(getTodayISODate());
</script>

<header class="topbar">
  <button class="brand brand-btn" on:click={() => navigateTo('entry')} aria-label="گیله‌کرد، صفحه ثبت خرید">
    <span class="brand-mark">گ</span>
    <span>
      <strong>گیله‌کُرد</strong>
      <small>مدیریت خرید رستوران</small>
    </span>
  </button>
  <div class="topbar-meta">
    <span class="status-dot"></span>
    <span>نسخه آفلاین محلی</span>
    <span class="today-label">{todayJalali}</span>
  </div>
</header>

<style>
  .brand-btn {
    background: none;
    border: none;
    padding: 0;
    text-align: right;
    cursor: pointer;
  }
</style>
