<script lang="ts">
  import { purchases } from '../../stores/purchaseStore';
  import { formatMoney, formatNumber } from '../../utils/formatters';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';
  let dateFrom = '';
  let dateTo = '';

  $: filteredPurchases = $purchases.filter((p) => {
    const q = searchQuery.trim().toLowerCase();
    const matchesName = !q || p.productName.toLowerCase().includes(q);
    const matchesFrom = !dateFrom || p.purchaseDate >= dateFrom;
    const matchesTo = !dateTo || p.purchaseDate <= dateTo;
    return matchesName && matchesFrom && matchesTo;
  });

  $: totalAmount = filteredPurchases.reduce((sum, p) => sum + p.totalAmount, 0);

  function clearFilters() {
    searchQuery = '';
    dateFrom = '';
    dateTo = '';
  }
</script>

<section class="page" aria-labelledby="historyTitle">
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
          bind:value={searchQuery} 
          placeholder="جست‌وجوی نام محصول..." 
          aria-label="جست‌وجوی نام محصول" 
        />
      </div>
      <label class="date-filter">
        <span>از تاریخ</span>
        <input type="date" bind:value={dateFrom} aria-label="از تاریخ" />
      </label>
      <label class="date-filter">
        <span>تا تاریخ</span>
        <input type="date" bind:value={dateTo} aria-label="تا تاریخ" />
      </label>
      <button class="quiet-btn" type="button" on:click={clearFilters}>پاک کردن</button>
    </div>

    <div class="history-summary">
      <span>{formatNumber(filteredPurchases.length)} خرید</span>
      <span>مجموع مبلغ: <strong>{formatMoney(totalAmount)} تومان</strong></span>
    </div>

    <div class="purchase-list">
      {#if filteredPurchases.length > 0}
        {#each filteredPurchases as purchase (purchase.id)}
          <PurchaseCard {purchase} />
        {/each}
      {:else}
        <EmptyState 
          title="موردی پیدا نشد" 
          message="عبارت جست‌وجو یا بازه تاریخ را تغییر دهید." 
        />
      {/if}
    </div>
  </section>
</section>
