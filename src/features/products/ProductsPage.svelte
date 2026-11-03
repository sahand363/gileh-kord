<script lang="ts">
  import { products, purchases } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import {
    formatMoney,
    formatNumber,
    normalizeProductKey,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';
  let selectedProductKey: string | null = null;

  $: filteredProducts = $products.filter((p) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    return !q || p.name.toLocaleLowerCase('fa-IR').includes(q);
  });

  function togglePriceHistory(productName: string) {
    const key = normalizeProductKey(productName);
    selectedProductKey = selectedProductKey === key ? null : key;
  }

  function getProductPurchases(productName: string) {
    const key = normalizeProductKey(productName);
    return $purchases.filter((p) => normalizeProductKey(p.productName) === key);
  }
</script>

<section class="page active" aria-labelledby="productsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">فهرست اقلام و تاریخچه نوسان قیمت (شمسی)</p>
      <h1 id="productsTitle">کالاها و محصولات</h1>
      <p class="subheading">
        فهرست تمام کالاهای ثبت‌شده به همراه آخرین قیمت خرید، واحد پیش‌فرض و ریز تاریخچه قیمت‌ها به تاریخ شمسی.
      </p>
    </div>
    <button type="button" class="secondary-btn" on:click={() => navigateTo('entry')}>
      ＋ ثبت خرید کالای جدید
    </button>
  </div>

  <section class="panel history-panel">
    <div class="filters">
      <div class="search-box">
        <span>⌕</span>
        <input
          bind:value={searchQuery}
          placeholder="جست‌وجوی نام کالا..."
          aria-label="جست‌وجوی نام کالا"
        />
      </div>
      {#if searchQuery}
        <button type="button" class="quiet-btn" on:click={() => (searchQuery = '')}>
          پاک کردن
        </button>
      {/if}
    </div>

    <div class="history-summary">
      <span>تعداد کل اقلام: <strong>{formatNumber(filteredProducts.length)} کالا</strong></span>
      <span>برای مشاهده سابقه قیمت هر کالا به تاریخ شمسی روی دکمه «تاریخچه قیمت» کلیک کنید</span>
    </div>

    <div class="purchase-list">
      {#if filteredProducts.length > 0}
        {#each filteredProducts as prod (prod.id)}
          {@const prodKey = normalizeProductKey(prod.name)}
          {@const isExpanded = selectedProductKey === prodKey}
          {@const historyItems = isExpanded ? getProductPurchases(prod.name) : []}

          <div class="product-card-group">
            <article class="purchase-item">
              <div class="product-avatar">{prod.name.charAt(0)}</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{prod.name}</span>
                  {#if prod.isDemo}
                    <span class="badge-demo">نمونه آزمایشی</span>
                  {:else}
                    <span class="badge-real">ثبت واقعی</span>
                  {/if}
                </div>
                <div class="purchase-meta">
                  <span>واحد مصرفی: {prod.lastUnit}</span>
                  <span>تعداد دفعات خرید: {formatNumber(prod.totalPurchasesCount)} مرتبه</span>
                  <span>آخرین خرید: {toJalaliDate(prod.lastPurchaseDate)} ({toJalaliNumeric(prod.lastPurchaseDate)})</span>
                </div>
              </div>
              <div class="purchase-side">
                <div class="purchase-amount">آخرین مبلغ: {formatMoney(prod.lastPrice)} تومان</div>
                <div style="margin-top: 6px;">
                  <button
                    type="button"
                    class="quiet-btn"
                    on:click={() => togglePriceHistory(prod.name)}
                  >
                    {isExpanded ? 'بستن تاریخچه ▴' : 'تاریخچه قیمت ▾'}
                  </button>
                </div>
              </div>
            </article>

            {#if isExpanded}
              <div class="price-history-drawer">
                <strong style="font-size: 11px; color: var(--green); display: block; margin-bottom: 8px;">
                  سابقه خرید و قیمت «{prod.name}» ({formatNumber(historyItems.length)} مورد):
                </strong>
                {#if historyItems.length > 0}
                  <div class="price-history-list">
                    {#each historyItems as hp (hp.id)}
                      <div class="price-history-row">
                        <span>{toJalaliDate(hp.purchaseDate)} ({toJalaliNumeric(hp.purchaseDate)})</span>
                        <span>{formatNumber(hp.quantity)} {hp.unit}</span>
                        <span>{hp.supplierName || 'بدون نام فروشنده'}</span>
                        <strong>{formatMoney(hp.totalAmount)} تومان</strong>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <small style="color: var(--muted);">سابقه‌ای برای این کالا یافت نشد.</small>
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {:else}
        <EmptyState
          title="کالایی یافت نشد"
          message="با ثبت هر خرید جدید، کالای مربوطه به‌صورت خودکار به این فهرست اضافه می‌شود."
        />
      {/if}
    </div>
  </section>
</section>
