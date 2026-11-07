<script lang="ts">
  import {
    publicRevenueStore,
    saveDailyTotalRevenue,
    addDetailedRevenueEntry
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatLivePriceInput,
    getTodayISODate,
    parseNumericInput,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    REVENUE_CATEGORIES,
    type PaymentMethod,
    type RevenueCategory,
    type RevenueRecordingMode
  } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let selectedDate = getTodayISODate();
  let recordingMode: RevenueRecordingMode = 'daily_total';

  let dailyTotalAmount = '';
  let cardAmount = '';
  let onlineAmount = '';
  let cashAmount = '';
  let dailyNotes = '';

  let entryCategory: RevenueCategory = 'فروش غذا (سالن)';
  let entryDescription = '';
  let entryQuantity = '';
  let entryUnitPrice = '';
  let entryAmount = '';
  let entryPaymentMethod: PaymentMethod = 'کارت‌خوان / بانکی';
  let entryNotes = '';

  let formError = '';
  let isSubmitting = false;

  $: {
    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(up) && up > 0) {
      entryAmount = formatLivePriceInput(Math.round(q * up));
    }
  }

  async function handleSaveDailyTotal() {
    if (isSubmitting) return;
    formError = '';
    const total = parseNumericInput(dailyTotalAmount);
    if (isNaN(total) || total <= 0) {
      formError = 'لطفاً مبلغ معتبر بزرگ‌تر از صفر وارد کنید.';
      return;
    }

    const card = parseNumericInput(cardAmount);
    const online = parseNumericInput(onlineAmount);
    const cash = parseNumericInput(cashAmount);

    isSubmitting = true;
    try {
      await saveDailyTotalRevenue({
        date: selectedDate,
        dailyTotalAmount: total,
        cardAmount: !isNaN(card) && card > 0 ? card : undefined,
        onlineAmount: !isNaN(online) && online > 0 ? online : undefined,
        cashAmount: !isNaN(cash) && cash > 0 ? cash : undefined,
        notes: dailyNotes
      });

      dailyTotalAmount = '';
      cardAmount = '';
      onlineAmount = '';
      cashAmount = '';
      dailyNotes = '';
      showToast('درآمد ثبت شد.');
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ثبت اطلاعات.';
    } finally {
      isSubmitting = false;
    }
  }

  async function handleAddDetailedItem() {
    if (isSubmitting) return;
    formError = '';
    const amount = parseNumericInput(entryAmount);
    if (isNaN(amount) || amount <= 0) {
      formError = 'مبلغ تراکنش باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);

    isSubmitting = true;
    try {
      await addDetailedRevenueEntry({
        date: selectedDate,
        category: entryCategory,
        description: entryDescription,
        quantity: !isNaN(q) && q > 0 ? q : undefined,
        unitPrice: !isNaN(up) && up > 0 ? up : undefined,
        amount,
        paymentMethod: entryPaymentMethod,
        notes: entryNotes
      });

      entryDescription = '';
      entryQuantity = '';
      entryUnitPrice = '';
      entryAmount = '';
      entryNotes = '';
      showToast('ردیف فروش ثبت شد.');
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ثبت ردیف فروش.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<section class="page active" aria-labelledby="revenueTitle">
  <div class="page-heading">
    <h1 id="revenueTitle">درآمد</h1>
  </div>

  <div class="entry-layout">
    <section class="panel form-panel">
      <div class="field">
        <label for="revDate">تاریخ ثبت</label>
        <JalaliDatePicker
          id="revDate"
          bind:value={selectedDate}
          ariaLabel="تاریخ ثبت"
        />
      </div>

      <div class="mode-switch-box" style="margin-bottom: 18px;">
        <div class="setting-actions">
          <button
            type="button"
            class={recordingMode === 'daily_total' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => {
              recordingMode = 'daily_total';
              formError = '';
            }}
          >
            {recordingMode === 'daily_total' ? '● ' : '○ '}
            ثبت کلی
          </button>
          <button
            type="button"
            class={recordingMode === 'detailed' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => {
              recordingMode = 'detailed';
              formError = '';
            }}
          >
            {recordingMode === 'detailed' ? '● ' : '○ '}
            ثبت موردی
          </button>
        </div>
      </div>

      {#if recordingMode === 'daily_total'}
        <form on:submit|preventDefault={handleSaveDailyTotal} autocomplete="off" novalidate>
          <div class="field">
            <label for="dailyRevTotal">
              مبلغ <span class="label-unit">تومان</span> <b class="required">*</b>
            </label>
            <div class="input-wrap price-wrap">
              <input
                id="dailyRevTotal"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={dailyTotalAmount}
                on:input={(e) => {
                  const t = e.currentTarget;
                  dailyTotalAmount = formatLivePriceInput(t.value);
                  t.value = dailyTotalAmount;
                }}
                placeholder="4،000،000"
                style="text-align: right;"
                required
              />
              <span class="currency">تومان</span>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revCard">کارت‌خوان (اختیاری)</label>
              <input
                id="revCard"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={cardAmount}
                on:input={(e) => {
                  const t = e.currentTarget;
                  cardAmount = formatLivePriceInput(t.value);
                  t.value = cardAmount;
                }}
                style="text-align: right;"
              />
            </div>
            <div class="field">
              <label for="revOnline">آنلاین (اختیاری)</label>
              <input
                id="revOnline"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={onlineAmount}
                on:input={(e) => {
                  const t = e.currentTarget;
                  onlineAmount = formatLivePriceInput(t.value);
                  t.value = onlineAmount;
                }}
                style="text-align: right;"
              />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revCash">نقدی (اختیاری)</label>
              <input
                id="revCash"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={cashAmount}
                on:input={(e) => {
                  const t = e.currentTarget;
                  cashAmount = formatLivePriceInput(t.value);
                  t.value = cashAmount;
                }}
                style="text-align: right;"
              />
            </div>
            <div class="field">
              <label for="revDailyNotes">توضیحات</label>
              <input id="revDailyNotes" bind:value={dailyNotes} />
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isSubmitting}>
            <span>{isSubmitting ? 'در حال ثبت...' : 'ثبت درآمد'}</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      {:else}
        <form on:submit|preventDefault={handleAddDetailedItem} autocomplete="off" novalidate>
          <div class="field-row">
            <div class="field">
              <label for="revEntryCat">دسته‌بندی</label>
              <select id="revEntryCat" bind:value={entryCategory}>
                {#each REVENUE_CATEGORIES as cat}
                  <option value={cat}>{cat}</option>
                {/each}
              </select>
            </div>
            <div class="field">
              <label for="revPayMethod">روش دریافت</label>
              <select id="revPayMethod" bind:value={entryPaymentMethod}>
                <option value="کارت‌خوان / بانکی">کارت‌خوان / بانکی</option>
                <option value="آنلاین">آنلاین</option>
                <option value="نقدی">نقدی</option>
                <option value="ترکیبی">ترکیبی</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label for="revDesc">شرح</label>
            <input id="revDesc" bind:value={entryDescription} />
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revQty">تعداد (اختیاری)</label>
              <input id="revQty" inputmode="decimal" bind:value={entryQuantity} />
            </div>
            <div class="field">
              <label for="revUnitPrice">فی واحد (اختیاری)</label>
              <input
                id="revUnitPrice"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={entryUnitPrice}
                on:input={(e) => {
                  const t = e.currentTarget;
                  entryUnitPrice = formatLivePriceInput(t.value);
                  t.value = entryUnitPrice;
                }}
                style="text-align: right;"
              />
            </div>
          </div>

          <div class="field">
            <label for="revItemAmount">
              مبلغ <span class="label-unit">تومان</span> <b class="required">*</b>
            </label>
            <div class="input-wrap price-wrap">
              <input
                id="revItemAmount"
                type="text"
                dir="ltr"
                inputmode="numeric"
                value={entryAmount}
                on:input={(e) => {
                  const t = e.currentTarget;
                  entryAmount = formatLivePriceInput(t.value);
                  t.value = entryAmount;
                }}
                style="text-align: right;"
                required
              />
              <span class="currency">تومان</span>
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isSubmitting}>
            <span>{isSubmitting ? 'در حال ثبت...' : '＋ ثبت ردیف'}</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      {/if}
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">₿</span>
          <span>درآمد</span>
        </div>
        <div class="stat-number">
          {formatMoney($publicRevenueStore.totalAmount)} <small>تومان</small>
        </div>
      </section>
    </aside>
  </div>

  <section class="recent-section">
    <div class="section-heading">
      <h2>آخرین تاریخ‌های ثبت‌شده</h2>
    </div>

    <div class="purchase-list">
      {#if $publicRevenueStore.recentDates.length > 0}
        {#each $publicRevenueStore.recentDates as item (item.id)}
          <article class="purchase-item">
            <div class="product-avatar">▦</div>
            <div class="purchase-main">
              <div class="purchase-name">
                <span>
                  {getPersianWeekdayName(item.date)} {toJalaliDate(item.date)} ({toJalaliNumeric(item.date)})
                </span>
              </div>
            </div>
            <div class="purchase-side">
              <span class="badge-real">ثبت شده ✓</span>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState
          title="تاریخی ثبت نشده است"
          message="پس از ثبت درآمد، تاریخ‌های ثبت‌شده در این قسمت نمایش داده می‌شوند."
        />
      {/if}
    </div>
  </section>
</section>
