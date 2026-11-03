<script lang="ts">
  import { purchases } from '../../stores/purchaseStore';
  import { formatMoney, formatNumber } from '../../utils/formatters';
  import {
    calculatePurchaseStats,
    filterPurchases
  } from '../../utils/calculations';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let searchQuery = '';
  let dateFrom = '';
  let dateTo = '';
  let onlyReal = false;

  $: filteredPurchases = filterPurchases($purchases, {
    query: searchQuery,
    dateFrom,
    dateTo,
    onlyReal
  });

  $: filteredStats = calculatePurchaseStats(filteredPurchases);
  $: hasActiveFilters = Boolean(searchQuery.trim() || dateFrom || dateTo || onlyReal);

  function clearFilters() {
    searchQuery = '';
    dateFrom = '';
    dateTo = '';
    onlyReal = false;
  }
</script>

<section class="page active" aria-labelledby="historyTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">گزارش و پیگیری با تقویم شمسی</p>
      <h1 id="historyTitle">تاریخچه خریدها</h1>
      <p class="subheading">خریدهای ثبت‌شده را بر اساس نام کالا، فروشنده یا بازه تاریخ شمسی جست‌وجو و بررسی کنید.</p>
    </div>
  </div>

  <section class="panel history-panel">
    <div class="filters">
      <div class="search-box">
        <span>⌕</span>
        <input
          id="historySearch"
          bind:value={searchQuery}
          placeholder="جست‌وجوی نام محصول، فروشنده یا شماره فاکتور..."
          aria-label="جست‌وجوی نام محصول"
        />
      </div>
      <div class="date-filter">
        <span>از تاریخ (شمسی)</span>
        <div class="date-picker-filter-wrap">
          <JalaliDatePicker
            id="dateFrom"
            bind:value={dateFrom}
            placeholder="همه تاریخ‌ها"
            allowEmpty={true}
            ariaLabel="از تاریخ شمسی"
          />
        </div>
      </div>
      <div class="date-filter">
        <span>تا تاریخ (شمسی)</span>
        <div class="date-picker-filter-wrap">
          <JalaliDatePicker
            id="dateTo"
            bind:value={dateTo}
            placeholder="همه تاریخ‌ها"
            allowEmpty={true}
            ariaLabel="تا تاریخ شمسی"
          />
        </div>
      </div>
      <button
        type="button"
        class={onlyReal ? 'secondary-btn' : 'quiet-btn'}
        on:click={() => (onlyReal = !onlyReal)}
      >
        {onlyReal ? '✓ فقط ثبت واقعی' : 'همه (شامل نمونه)'}
      </button>
      <button id="clearFilters" class="quiet-btn" type="button" on:click={clearFilters}>
        پاک کردن فیلترها
      </button>
    </div>

    <div class="history-summary">
      <span id="historyCount">{formatNumber(filteredStats.count)} خرید منطبق</span>
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
          message="عبارت جست‌وجو یا بازه تاریخ شمسی را تغییر دهید."
        />
      {/if}
    </div>
  </section>
</section>
