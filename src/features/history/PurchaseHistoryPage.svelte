<script lang="ts">
  import { purchases } from '../../stores/purchaseStore';
  import { formatMoney, formatNumber, toJalaliDate } from '../../utils/formatters';
  import {
    calculatePurchaseStats,
    filterPurchases
  } from '../../utils/calculations';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';
  let dateFrom = '';
  let dateTo = '';

  $: filteredPurchases = filterPurchases($purchases, {
    query: searchQuery,
    dateFrom,
    dateTo
  });

  $: filteredStats = calculatePurchaseStats(filteredPurchases);
  $: hasActiveFilters = Boolean(searchQuery.trim() || dateFrom || dateTo);

  function clearFilters() {
    searchQuery = '';
    dateFrom = '';
    dateTo = '';
  }
</script>

<section class="page active" aria-labelledby="historyTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">گزارش و پیگیری</p>
      <h1 id="historyTitle">تاریخچه خریدها</h1>
      <p class="subheading">خریدهای ثبت‌شده را جست‌وجو و بررسی کنید.</p>
    </div>
  </div>

  <section class="panel history-panel">
    <div class="filters">
      <div class="search-box">
        <span>⌕</span>
        <input
          id="historySearch"
          bind:value={searchQuery}
          placeholder="جست‌وجوی نام محصول..."
          aria-label="جست‌وجوی نام محصول"
        />
      </div>
      <label class="date-filter" title={dateFrom ? `معادل: ${toJalaliDate(dateFrom)}` : ''}>
        <span>از تاریخ</span>
        <input id="dateFrom" type="date" bind:value={dateFrom} aria-label="از تاریخ" />
      </label>
      <label class="date-filter" title={dateTo ? `معادل: ${toJalaliDate(dateTo)}` : ''}>
        <span>تا تاریخ</span>
        <input id="dateTo" type="date" bind:value={dateTo} aria-label="تا تاریخ" />
      </label>
      <button id="clearFilters" class="quiet-btn" type="button" on:click={clearFilters}>
        پاک کردن
      </button>
    </div>

    <div class="history-summary">
      <span id="historyCount">{formatNumber(filteredStats.count)} خرید</span>
      <span>
        مجموع مبلغ: <strong id="historyTotal">{formatMoney(filteredStats.total)} تومان</strong>
      </span>
    </div>

    <div id="historyList" class="purchase-list">
      {#if filteredPurchases.length > 0}
        {#each filteredPurchases as purchase (purchase.id)}
          <PurchaseCard {purchase} />
        {/each}
      {:else if $purchases.length === 0 && !hasActiveFilters}
        <EmptyState
          title="هنوز خریدی ثبت نشده است"
          message="پس از ثبت اولین خرید، فهرست کامل خریدها در این بخش نمایش داده می‌شود."
        />
      {:else}
        <EmptyState
          title="موردی پیدا نشد"
          message="عبارت جست‌وجو یا بازه تاریخ را تغییر دهید."
        />
      {/if}
    </div>
  </section>
</section>
