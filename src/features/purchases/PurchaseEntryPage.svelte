<script lang="ts">
  import { onMount } from 'svelte';
  import { productRepository } from '../../services/repositories/ProductRepository';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import {
    addPurchase,
    todayPurchasesStats,
    recentPurchases,
    suppliers,
    dbError
  } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate,
    parseNumericInput
  } from '../../utils/formatters';
  import { validatePurchaseInput } from '../../utils/validators';
  import { MEASUREMENT_UNITS, type Product } from '../../models/types';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let productName = '';
  let quantity = '';
  let defaultUnit = 'کیلوگرم';
  let unit = 'کیلوگرم';
  let price = '';
  let purchaseDate = getTodayISODate();
  let supplier = '';
  let invoice = '';
  let notes = '';

  let productInputEl: HTMLInputElement;
  let quantityInputEl: HTMLInputElement;

  let errorMessage = '';
  let isSubmitting = false;
  let suggestions: Product[] = [];
  let isSuggestionsVisible = false;
  let lastPriceHint = '';
  let optionalOpen = false;

  const todayISO = getTodayISODate();
  const todayFullJalali = `${toJalaliDate(todayISO)} (${toJalaliNumeric(todayISO)})`;

  $: parsedLivePrice = parseNumericInput(price);
  $: liveFormattedPrice =
    !isNaN(parsedLivePrice) && parsedLivePrice > 0
      ? `${formatMoney(parsedLivePrice)} تومان`
      : '';

  onMount(async () => {
    const settings = await settingsRepository.getSettings();
    if (settings.defaultUnit) {
      defaultUnit = settings.defaultUnit;
      unit = settings.defaultUnit;
    }
  });

  async function handleProductInput() {
    const query = productName.trim();
    if (!query) {
      suggestions = [];
      isSuggestionsVisible = false;
      lastPriceHint = '';
      return;
    }
    try {
      suggestions = await productRepository.search(query, 5);
      isSuggestionsVisible = true;
    } catch {
      suggestions = [];
      isSuggestionsVisible = false;
    }
  }

  function selectProduct(prod: Product) {
    productName = prod.name;
    unit = prod.lastUnit;
    isSuggestionsVisible = false;
    lastPriceHint = `آخرین مبلغ ثبت‌شده: ${formatMoney(prod.lastPrice)} تومان در تاریخ ${toJalaliDate(prod.lastPurchaseDate)}`;
    quantityInputEl?.focus();
  }

  function handleProductKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      isSuggestionsVisible = false;
    }
  }

  function handleWindowClick(e: MouseEvent) {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('.product-field')) {
      isSuggestionsVisible = false;
    }
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    errorMessage = '';

    const validation = validatePurchaseInput({
      productName,
      quantity,
      price,
      purchaseDate
    });

    if (!validation.isValid || !validation.cleanData) {
      errorMessage = validation.error || 'اطلاعات واردشده نامعتبر است.';
      return;
    }

    isSubmitting = true;
    try {
      await addPurchase({
        productName: validation.cleanData.productName,
        quantity: validation.cleanData.quantity,
        unit,
        price: validation.cleanData.price,
        purchaseDate: validation.cleanData.purchaseDate,
        supplier,
        invoice,
        notes
      });

      productName = '';
      quantity = '';
      unit = defaultUnit;
      price = '';
      purchaseDate = getTodayISODate();
      supplier = '';
      invoice = '';
      notes = '';
      lastPriceHint = '';
      suggestions = [];
      isSuggestionsVisible = false;
      optionalOpen = false;

      showToast('خرید با موفقیت در پایگاه داده محلی ثبت شد.');
      productInputEl?.focus();
    } catch (err) {
      console.error(err);
      errorMessage =
        err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات خرید.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<svelte:window on:click={handleWindowClick} />

<section class="page active" aria-labelledby="entryTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">ثبت سریع و آسان (تقویم شمسی)</p>
      <h1 id="entryTitle">ثبت خرید جدید</h1>
      <p class="subheading">خریدهای روزانه را در چند ثانیه ثبت کنید؛ کارکرد کامل در حالت آنلاین، آفلاین، HTTP و HTTPS.</p>
    </div>
    <div class="heading-date">
      <span class="calendar-icon">▦</span>
      <span>{todayFullJalali}</span>
    </div>
  </div>

  {#if $dbError}
    <div class="form-error" role="alert">{$dbError}</div>
  {/if}

  <div class="entry-layout">
    <section class="panel form-panel">
      <form on:submit|preventDefault={handleSubmit} autocomplete="off" novalidate>
        <div class="field product-field">
          <label for="productName">نام محصول <b class="required">*</b></label>
          <div class="input-wrap">
            <input
              id="productName"
              name="productName"
              type="text"
              role="combobox"
              bind:this={productInputEl}
              bind:value={productName}
              on:input={handleProductInput}
              on:focus={handleProductInput}
              on:keydown={handleProductKeydown}
              placeholder="مثلاً برنج هاشمی"
              required
              aria-autocomplete="list"
              aria-controls="suggestions"
              aria-expanded={isSuggestionsVisible}
            />
            <span class="field-symbol">⌕</span>
          </div>

          {#if isSuggestionsVisible}
            <div class="suggestions" id="suggestions" role="listbox">
              {#if suggestions.length > 0}
                {#each suggestions as prod (prod.id)}
                  <button
                    type="button"
                    class="suggestion-item"
                    role="option"
                    aria-selected="false"
                    on:click={() => selectProduct(prod)}
                  >
                    <span>
                      <span class="suggestion-name">{prod.name}</span>
                      <span class="suggestion-meta">
                        <span>واحد: {prod.lastUnit}</span>
                        <span>آخرین تاریخ: {toJalaliDate(prod.lastPurchaseDate)}</span>
                      </span>
                    </span>
                    <span class="suggestion-price">
                      آخرین خرید: {formatMoney(prod.lastPrice)} تومان
                    </span>
                  </button>
                {/each}
              {:else}
                <div class="suggestion-empty">محصول جدیدی با این نام ثبت می‌شود.</div>
              {/if}
            </div>
          {/if}

          <small class="field-hint">نام محصول را بنویسید یا از موارد قبلی انتخاب کنید.</small>
        </div>

        <div class="field-row quantity-row">
          <div class="field">
            <label for="quantity">مقدار <b class="required">*</b></label>
            <input
              id="quantity"
              name="quantity"
              inputmode="decimal"
              bind:this={quantityInputEl}
              bind:value={quantity}
              placeholder="مثلاً ۵ یا ۲٫۵"
              required
            />
          </div>
          <div class="field">
            <label for="unit">واحد</label>
            <select id="unit" name="unit" bind:value={unit}>
              {#each MEASUREMENT_UNITS as itemUnit}
                <option value={itemUnit}>{itemUnit}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="field">
          <label for="price">
            مبلغ کل <span class="label-unit">تومان</span> <b class="required">*</b>
          </label>
          <div class="input-wrap price-wrap">
            <input
              id="price"
              name="price"
              inputmode="numeric"
              bind:value={price}
              placeholder="مثلاً ۲٬۵۰۰٬۰۰۰"
              required
            />
            <span class="currency">تومان</span>
          </div>
          {#if lastPriceHint}
            <small id="priceHint" class="field-hint">{lastPriceHint}</small>
          {:else if liveFormattedPrice}
            <small class="field-hint">مبلغ به حروف عددی: {liveFormattedPrice}</small>
          {/if}
        </div>

        <div class="field">
          <label for="purchaseDate">تاریخ خرید (شمسی)</label>
          <JalaliDatePicker
            id="purchaseDate"
            bind:value={purchaseDate}
            ariaLabel="تاریخ خرید شمسی"
          />
        </div>

        <details class="optional-fields" bind:open={optionalOpen}>
          <summary>
            <span>اطلاعات تکمیلی</span>
            <span class="optional-tag">اختیاری</span>
            <span class="chevron">⌄</span>
          </summary>
          <div class="optional-grid">
            <div class="field">
              <label for="supplier">نام فروشنده</label>
              <input
                id="supplier"
                name="supplier"
                list="suppliersDatalist"
                bind:value={supplier}
                placeholder="نام فروشگاه یا تأمین‌کننده"
              />
              <datalist id="suppliersDatalist">
                {#each $suppliers as sup (sup.id)}
                  <option value={sup.name}></option>
                {/each}
              </datalist>
            </div>
            <div class="field">
              <label for="invoice">شماره فاکتور</label>
              <input
                id="invoice"
                name="invoice"
                bind:value={invoice}
                placeholder="مثلاً ۱۲۴۸"
              />
            </div>
            <div class="field full">
              <label for="notes">توضیحات</label>
              <textarea
                id="notes"
                name="notes"
                rows="2"
                bind:value={notes}
                placeholder="توضیحات تکمیلی درباره خرید..."
              ></textarea>
            </div>
          </div>
        </details>

        {#if errorMessage}
          <div class="form-error" id="formError" role="alert">{errorMessage}</div>
        {/if}

        <button class="primary-btn" type="submit" disabled={isSubmitting}>
          <span>{isSubmitting ? 'در حال ثبت...' : 'ثبت خرید'}</span>
          <span class="btn-arrow">←</span>
        </button>
        <p class="secure-note">
          <span>✓</span> ذخیره‌سازی آنی در حافظه محلی دستگاه (IndexedDB) — بدون وابستگی به اینترنت یا HTTPS.
        </p>
      </form>
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">↗</span>
          <span>خلاصه امروز ({toJalaliDate(todayISO)})</span>
        </div>
        <div class="stat-number" id="todayTotal">
          {formatMoney($todayPurchasesStats.total)} <small>تومان</small>
        </div>
        <p class="stat-caption">
          <strong id="todayCount">{formatNumber($todayPurchasesStats.count)}</strong> خرید ثبت‌شده امروز
        </p>
        <div class="stat-divider"></div>
        <div class="stat-foot">
          <span>میانگین هر خرید</span>
          <strong id="todayAverage">{formatMoney($todayPurchasesStats.average)} تومان</strong>
        </div>
      </section>

      <section class="tip-card">
        <span class="tip-icon">✳</span>
        <div>
          <strong>ثبت سریع‌تر خریدها</strong>
          <p>
            با انتخاب محصولاتی که قبلاً ثبت کرده‌اید، واحد اندازه‌گیری و آخرین قیمت خرید به تاریخ شمسی نمایش داده می‌شود.
          </p>
        </div>
      </section>
    </aside>
  </div>

  <section class="recent-section">
    <div class="section-heading">
      <div>
        <h2>آخرین خریدها</h2>
        <p>نگاهی سریع به خریدهای اخیر</p>
      </div>
      <button class="text-btn" type="button" on:click={() => navigateTo('history')}>
        مشاهده همه <span>←</span>
      </button>
    </div>

    <div id="recentList" class="purchase-list">
      {#if $recentPurchases.length > 0}
        {#each $recentPurchases as purchase (purchase.id)}
          <PurchaseCard {purchase} />
        {/each}
      {:else}
        <EmptyState
          title="هنوز خریدی ثبت نشده است"
          message="اولین خرید خود را از فرم بالا ثبت کنید."
        />
      {/if}
    </div>
  </section>
</section>
