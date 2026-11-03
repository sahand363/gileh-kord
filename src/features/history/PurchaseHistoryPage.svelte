<script lang="ts">
  import { purchases, employees, suppliers } from '../../stores/purchaseStore';
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
  let selectedEmployeeId = '';
  let selectedSupplier = '';
  let onlyReal = false;

  $: filteredPurchases = filterPurchases($purchases, {
    query: searchQuery,
    dateFrom,
    dateTo,
    employeeId: selectedEmployeeId,
    supplierName: selectedSupplier,
    onlyReal
  });

  $: filteredStats = calculatePurchaseStats(filteredPurchases);
  $: hasActiveFilters = Boolean(
    searchQuery.trim() ||
      dateFrom ||
      dateTo ||
      selectedEmployeeId ||
      selectedSupplier ||
      onlyReal
  );

  function clearFilters() {
    searchQuery = '';
    dateFrom = '';
    dateTo = '';
    selectedEmployeeId = '';
    selectedSupplier = '';
    onlyReal = false;
  }
</script>

<section class="page active" aria-labelledby="historyTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">گزارش و پیگیری با تقویم شمسی و تفکیک مسئول خرید</p>
      <h1 id="historyTitle">تاریخچه خریدها</h1>
      <p class="subheading">
        خریدهای ثبت‌شده را بر اساس کارمند مسئول خرید، نام کالا، فروشنده یا بازه تاریخ شمسی فیلتر کنید.
      </p>
    </div>
  </div>

  <section class="panel history-panel">
    <div class="filters">
      <div class="search-box">
        <span>⌕</span>
        <input
          id="historySearch"
          bind:value={searchQuery}
          placeholder="جست‌وجوی نام محصول یا شماره فاکتور..."
          aria-label="جست‌وجوی نام محصول"
        />
      </div>

      <select
        id="historyEmployeeFilter"
        bind:value={selectedEmployeeId}
        style="width: auto; min-width: 165px; height: 42px; font-size: 11px;"
        aria-label="فیلتر بر اساس کارمند مسئول خرید"
      >
        <option value="">همه کارکنان (مسئول خرید)</option>
        <option value="__unassigned__">بدون ثبت مسئول خرید</option>
        {#each $employees as emp (emp.id)}
          <option value={emp.id}>
            {emp.name} ({emp.role})
          </option>
        {/each}
      </select>

      <select
        id="historySupplierFilter"
        bind:value={selectedSupplier}
        style="width: auto; min-width: 150px; height: 42px; font-size: 11px;"
        aria-label="فیلتر بر اساس فروشنده"
      >
        <option value="">همه فروشندگان</option>
        {#each $suppliers as sup (sup.id)}
          <option value={sup.name}>{sup.name}</option>
        {/each}
      </select>

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
          message="فیلتر کارمند، عبارت جست‌وجو یا بازه تاریخ شمسی را تغییر دهید."
        />
      {/if}
    </div>
  </section>
</section>
