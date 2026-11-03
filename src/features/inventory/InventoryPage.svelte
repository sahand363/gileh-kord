<script lang="ts">
  import {
    inventory,
    updateInventoryStock,
    addInventoryItem
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import { formatNumber, toJalaliDate, parseNumericInput } from '../../utils/formatters';
  import { getLowStockItems } from '../../utils/calculations';
  import { MEASUREMENT_UNITS } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';

  let searchQuery = '';
  let onlyLowStock = false;

  let productName = '';
  let category = 'مواد اولیه آشپزخانه';
  let currentStock = '';
  let minStockThreshold = '۵';
  let unit = 'کیلوگرم';
  let formError = '';

  $: lowStockCount = getLowStockItems($inventory).length;

  $: filteredInventory = $inventory.filter((item) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    const matchesSearch =
      !q ||
      item.productName.toLocaleLowerCase('fa-IR').includes(q) ||
      item.category.toLocaleLowerCase('fa-IR').includes(q);
    const matchesLow = !onlyLowStock || item.currentStock <= item.minStockThreshold;
    return matchesSearch && matchesLow;
  });

  async function handleStockAdjust(id: string, delta: number, name: string) {
    await updateInventoryStock(id, delta);
    showToast(
      delta > 0
        ? `موجودی «${name}» افزایش یافت.`
        : `مصرف «${name}» از انبار کسر شد.`
    );
  }

  async function handleCreateInventoryItem() {
    formError = '';
    if (!productName.trim()) {
      formError = 'لطفاً نام کالا را وارد کنید.';
      return;
    }

    const stockVal = parseNumericInput(currentStock);
    const minVal = parseNumericInput(minStockThreshold);

    if (isNaN(stockVal) || stockVal < 0) {
      formError = 'موجودی فعلی باید عددی صفر یا بزرگ‌تر باشد.';
      return;
    }
    if (isNaN(minVal) || minVal < 0) {
      formError = 'حداقل موجودی مجاز نامعتبر است.';
      return;
    }

    await addInventoryItem({
      productName,
      category,
      currentStock: stockVal,
      minStockThreshold: minVal,
      unit
    });

    productName = '';
    currentStock = '';
    minStockThreshold = '۵';
    showToast('کالای جدید در انبار ثبت شد.');
  }
</script>

<section class="page active" aria-labelledby="inventoryTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">کنترل موجودی آشپزخانه و انبار</p>
      <h1 id="inventoryTitle">انبار و موجودی کالا</h1>
      <p class="subheading">
        موجودی اقلام با ثبت هر خرید جدید به‌طور خودکار افزایش می‌یابد. همچنین می‌توانید مصرف روزانه را دستی کسر کنید.
      </p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel history-panel">
      <div class="filters">
        <div class="search-box">
          <span>⌕</span>
          <input
            bind:value={searchQuery}
            placeholder="جست‌وجوی نام کالا یا دسته‌بندی انبار..."
            aria-label="جست‌وجوی انبار"
          />
        </div>
        <button
          type="button"
          class={onlyLowStock ? 'secondary-btn' : 'quiet-btn'}
          on:click={() => (onlyLowStock = !onlyLowStock)}
        >
          {onlyLowStock
            ? `✓ فقط کالاهای رو به اتمام (${formatNumber(lowStockCount)})`
            : `نمایش کمبودها (${formatNumber(lowStockCount)})`}
        </button>
      </div>

      <div class="history-summary">
        <span>تعداد اقلام انبار: <strong>{formatNumber(filteredInventory.length)} قلم</strong></span>
        <span>اقلام زیر حد مجاز: <strong>{formatNumber(lowStockCount)} مورد</strong></span>
      </div>

      <div class="purchase-list">
        {#if filteredInventory.length > 0}
          {#each filteredInventory as item (item.id)}
            <article class="purchase-item">
              <div class="product-avatar">{item.productName.charAt(0)}</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{item.productName}</span>
                  {#if item.currentStock <= item.minStockThreshold}
                    <span class="badge-low">کمتر از حد مجاز</span>
                  {/if}
                  {#if item.isDemo}
                    <span class="badge-demo">نمونه آزمایشی</span>
                  {:else}
                    <span class="badge-real">ثبت واقعی</span>
                  {/if}
                </div>
                <div class="purchase-meta">
                  <span>دسته: {item.category}</span>
                  <span>حداقل مجاز: {formatNumber(item.minStockThreshold)} {item.unit}</span>
                  <span>بروزرسانی: {toJalaliDate(item.lastUpdated)}</span>
                </div>
              </div>
              <div class="purchase-side">
                <div class="purchase-amount">
                  {formatNumber(item.currentStock)} {item.unit}
                </div>
                <div class="stock-controls" style="margin-top: 6px;">
                  <button
                    type="button"
                    class="stock-btn"
                    title="افزایش موجودی (+۱)"
                    on:click={() => handleStockAdjust(item.id, 1, item.productName)}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    class="stock-btn"
                    title="ثبت مصرف (-۱)"
                    on:click={() => handleStockAdjust(item.id, -1, item.productName)}
                  >
                    −
                  </button>
                </div>
              </div>
            </article>
          {/each}
        {:else}
          <EmptyState
            title="موردی در انبار یافت نشد"
            message="از فرم روبه‌رو کالای جدید تعریف کنید یا فیلترها را تغییر دهید."
          />
        {/if}
      </div>
    </section>

    <aside class="panel form-panel">
      <div class="section-heading">
        <div>
          <h2>تعریف کالای انبار</h2>
          <p>ثبت موجودی اولیه و نقطه سفارش</p>
        </div>
      </div>

      <form on:submit|preventDefault={handleCreateInventoryItem} novalidate>
        <div class="field">
          <label for="invName">نام کالا <b class="required">*</b></label>
          <input id="invName" bind:value={productName} placeholder="مثلاً رب گوجه‌فرنگی" required />
        </div>

        <div class="field">
          <label for="invCategory">دسته‌بندی</label>
          <input id="invCategory" bind:value={category} placeholder="مثلاً خشکبار، پروتئینی، بسته‌بندی" />
        </div>

        <div class="field-row">
          <div class="field">
            <label for="invStock">موجودی فعلی <b class="required">*</b></label>
            <input id="invStock" inputmode="decimal" bind:value={currentStock} placeholder="مثلاً ۱۰" required />
          </div>
          <div class="field">
            <label for="invUnit">واحد</label>
            <select id="invUnit" bind:value={unit}>
              {#each MEASUREMENT_UNITS as u}
                <option value={u}>{u}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="invMin">حداقل موجودی مجاز (هشدار کسری)</label>
          <input id="invMin" inputmode="decimal" bind:value={minStockThreshold} placeholder="مثلاً ۵" />
        </div>

        {#if formError}
          <div class="form-error" role="alert">{formError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>افزودن به انبار</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </aside>
  </div>
</section>
