<script lang="ts">
  import { onMount } from 'svelte';
  import { productRepository } from '../../services/repositories/ProductRepository';
  import { settingsRepository } from '../../services/repositories/SettingsRepository';
  import {
    purchases,
    addPurchase,
    suppliers,
    employees,
    activeEmployees,
    appSettings,
    setStickyEmployeeId,
    dbError
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    getTodayISODate,
    parseNumericInput
  } from '../../utils/formatters';
  import { validatePurchaseInput } from '../../utils/validators';
  import {
    calculatePurchaseStats,
    filterPurchases
  } from '../../utils/calculations';
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
  let selectedEmployeeId = '';
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

  // Embedded Purchase History Filter State
  let searchQuery = '';
  let dateFrom = '';
  let dateTo = '';
  let historyEmployeeId = '';
  let historySupplier = '';
  let onlyReal = false;

  $: parsedLivePrice = parseNumericInput(price);
  $: liveFormattedPrice =
    !isNaN(parsedLivePrice) && parsedLivePrice > 0
      ? `${formatMoney(parsedLivePrice)} تومان`
      : '';

  $: if (!selectedEmployeeId && $appSettings.lastSelectedEmployeeId) {
    selectedEmployeeId = $appSettings.lastSelectedEmployeeId;
  } else if (!selectedEmployeeId && $activeEmployees.length > 0) {
    selectedEmployeeId = $activeEmployees[0].id;
  }

  $: filteredPurchases = filterPurchases($purchases, {
    query: searchQuery,
    dateFrom,
    dateTo,
    employeeId: historyEmployeeId,
    supplierName: historySupplier,
    onlyReal
  });

  $: filteredStats = calculatePurchaseStats(filteredPurchases);

  onMount(async () => {
    const settings = await settingsRepository.getSettings();
    if (settings.defaultUnit) {
      defaultUnit = settings.defaultUnit;
      unit = settings.defaultUnit;
    }
    if (settings.lastSelectedEmployeeId) {
      selectedEmployeeId = settings.lastSelectedEmployeeId;
    } else if ($activeEmployees.length > 0) {
      selectedEmployeeId = $activeEmployees[0].id;
    }
  });

  async function handleEmployeeChange() {
    if (selectedEmployeeId) {
      await setStickyEmployeeId(selectedEmployeeId);
    }
  }

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

  function clearHistoryFilters() {
    searchQuery = '';
    dateFrom = '';
    dateTo = '';
    historyEmployeeId = '';
    historySupplier = '';
    onlyReal = false;
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    errorMessage = '';

    if (!selectedEmployeeId) {
      errorMessage = 'لطفاً مسئول خرید (خرید توسط) را انتخاب کنید.';
      return;
    }

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
        employeeId: selectedEmployeeId,
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

      showToast('خرید با موفقیت ثبت شد.');
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
    <h1 id="entryTitle">ثبت خرید</h1>
  </div>

  {#if $dbError}
    <div class="form-error" role="alert">{$dbError}</div>
  {/if}

  <section class="panel form-panel" style="max-width: 720px; margin: 0 auto 28px;">
    <form on:submit|preventDefault={handleSubmit} autocomplete="off" novalidate>
      <div class="field">
        <label for="purchasedBy">
          خرید توسط <b class="required">*</b>
        </label>

        {#if $employees.length > 0}
          <select
            id="purchasedBy"
            name="purchasedBy"
            bind:value={selectedEmployeeId}
            on:change={handleEmployeeChange}
            required
          >
            {#each $activeEmployees as emp (emp.id)}
              <option value={emp.id}>
                {emp.name} — {emp.role}
              </option>
            {/each}
            {#each $employees.filter((e) => !e.isActive) as inactiveEmp (inactiveEmp.id)}
              {#if inactiveEmp.id === selectedEmployeeId}
                <option value={inactiveEmp.id}>
                  {inactiveEmp.name} — {inactiveEmp.role} (غیرفعال)
                </option>
              {/if}
            {/each}
          </select>
        {:else}
          <div class="form-error" style="margin-bottom: 6px;">
            لطفاً از بخش مدیریت حداقل یک کارمند تعریف کنید.
          </div>
        {/if}
      </div>

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
          <small class="field-hint">{liveFormattedPrice}</small>
        {/if}
      </div>

      <div class="field">
        <label for="purchaseDate">تاریخ خرید</label>
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
    </form>
  </section>

  <!-- Embedded Purchase History at the bottom of Purchase Registration -->
  <section id="embeddedPurchaseHistory" class="panel history-panel">
    <div class="section-heading">
      <h2>تاریخچه خریدها</h2>
    </div>

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
        bind:value={historyEmployeeId}
        style="width: auto; min-width: 155px; height: 42px; font-size: 11px;"
        aria-label="فیلتر بر اساس کارمند"
      >
        <option value="">همه کارکنان</option>
        <option value="__unassigned__">بدون ثبت مسئول خرید</option>
        {#each $employees as emp (emp.id)}
          <option value={emp.id}>{emp.name}</option>
        {/each}
      </select>

      <div class="date-filter">
        <span>از تاریخ</span>
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
        <span>تا تاریخ</span>
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

      <button id="clearFilters" class="quiet-btn" type="button" on:click={clearHistoryFilters}>
        پاک کردن فیلترها
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
      {:else}
        <EmptyState
          title="موردی پیدا نشد"
          message="هنوز خریدی ثبت نشده یا فیلترها نتیجه‌ای ندارند."
        />
      {/if}
    </div>
  </section>
</section>
