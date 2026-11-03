<script lang="ts">
  import { products } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import { formatMoney, formatNumber, toJalaliDate } from '../../utils/formatters';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';

  $: filteredProducts = $products.filter((p) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    return !q || p.name.toLocaleLowerCase('fa-IR').includes(q);
  });
</script>

<section class="page active" aria-labelledby="productsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">فهرست اقلام و مواد اولیه</p>
      <h1 id="productsTitle">کالاها و محصولات</h1>
      <p class="subheading">
        فهرست تمام کالاهای ثبت‌شده به همراه آخرین قیمت خرید، واحد پیش‌فرض و دفعات تکرار خرید.
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
      <span>پیشنهاد خودکار واحد در فرم خرید از این جدول تغذیه می‌شود</span>
    </div>

    <div class="purchase-list">
      {#if filteredProducts.length > 0}
        {#each filteredProducts as prod (prod.id)}
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
                <span>آخرین خرید: {toJalaliDate(prod.lastPurchaseDate)}</span>
              </div>
            </div>
            <div class="purchase-side">
              <div class="purchase-amount">آخرین مبلغ: {formatMoney(prod.lastPrice)} تومان</div>
              <div class="purchase-date">واحد پایه: {prod.lastUnit}</div>
            </div>
          </article>
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
