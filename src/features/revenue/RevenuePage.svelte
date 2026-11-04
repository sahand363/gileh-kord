<script lang="ts">
  import {
    saveDailyTotalRevenue,
    addDetailedRevenueEntry
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    getTodayISODate,
    parseNumericInput,
    toJalaliDate
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    REVENUE_CATEGORIES,
    type PaymentMethod,
    type RevenueCategory,
    type RevenueRecordingMode
  } from '../../models/types';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let selectedDate = getTodayISODate();
  let recordingMode: RevenueRecordingMode = 'daily_total';

  // Mode A: Single entry fields
  let dailyTotalAmount = '';
  let cardAmount = '';
  let onlineAmount = '';
  let cashAmount = '';
  let dailyNotes = '';

  // Mode B: Itemized entry fields
  let entryCategory: RevenueCategory = 'فروش غذا (سالن)';
  let entryDescription = '';
  let entryQuantity = '';
  let entryUnitPrice = '';
  let entryAmount = '';
  let entryPaymentMethod: PaymentMethod = 'کارت‌خوان / بانکی';
  let entryNotes = '';

  let formError = '';
  let isSubmitting = false;

  // Auto-calculate itemized amount if quantity and unit price are provided
  $: {
    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(up) && up > 0) {
      entryAmount = String(Math.round(q * up));
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
      showToast('اطلاعات فروش با موفقیت ثبت شد.');
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
      showToast('ردیف فروش با موفقیت ثبت شد.');
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ثبت ردیف فروش.';
    } finally {
      isSubmitting = false;
    }
  }
</script>

<section class="page active" aria-labelledby="revenueTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">ثبت سریع صندوق و فروش</p>
      <h1 id="revenueTitle">ثبت درآمد</h1>
      <p class="subheading">اطلاعات فروش را وارد و ثبت کنید.</p>
    </div>
  </div>

  <div style="max-width: 620px; margin: 0 auto;">
    <section class="panel form-panel">
      <div class="field">
        <label for="revDate">تاریخ ثبت (شمسی)</label>
        <JalaliDatePicker
          id="revDate"
          bind:value={selectedDate}
          ariaLabel="تاریخ ثبت"
        />
      </div>

      <div class="mode-switch-box" style="margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px;">
          روش ثبت برای {getPersianWeekdayName(selectedDate)} {toJalaliDate(selectedDate)}:
        </div>
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
            ثبت کلی (یکجا)
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
            ثبت موردی (ریز فروش)
          </button>
        </div>
      </div>

      {#if recordingMode === 'daily_total'}
        <form on:submit|preventDefault={handleSaveDailyTotal} autocomplete="off" novalidate>
          <div class="field">
            <label for="dailyRevTotal">
              مبلغ کل <span class="label-unit">تومان</span> <b class="required">*</b>
            </label>
            <div class="input-wrap price-wrap">
              <input
                id="dailyRevTotal"
                inputmode="numeric"
                bind:value={dailyTotalAmount}
                placeholder="مثلاً ۱۸٬۵۰۰٬۰۰۰"
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
                inputmode="numeric"
                bind:value={cardAmount}
                placeholder="مبلغ کارت‌خوان"
              />
            </div>
            <div class="field">
              <label for="revOnline">آنلاین (اختیاری)</label>
              <input
                id="revOnline"
                inputmode="numeric"
                bind:value={onlineAmount}
                placeholder="مبلغ آنلاین"
              />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revCash">نقدی (اختیاری)</label>
              <input
                id="revCash"
                inputmode="numeric"
                bind:value={cashAmount}
                placeholder="مبلغ نقدی"
              />
            </div>
            <div class="field">
              <label for="revDailyNotes">توضیحات (اختیاری)</label>
              <input
                id="revDailyNotes"
                bind:value={dailyNotes}
                placeholder="توضیحات..."
              />
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isSubmitting}>
            <span>{isSubmitting ? 'در حال ثبت...' : 'ثبت درآمد'}</span>
            <span class="btn-arrow">←</span>
          </button>
          <p class="secure-note">
            <span>✓</span> اطلاعات در حافظه دستگاه ثبت شده و فقط در پنل مدیریت قابل مشاهده است.
          </p>
        </form>
      {:else}
        <form on:submit|preventDefault={handleAddDetailedItem} autocomplete="off" novalidate>
          <div class="field-row">
            <div class="field">
              <label for="revEntryCat">دسته‌بندی فروش</label>
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
            <label for="revDesc">شرح فروش</label>
            <input
              id="revDesc"
              bind:value={entryDescription}
              placeholder="مثلاً فروش سالن یا سفارش بیرون‌بر..."
            />
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revQty">تعداد (اختیاری)</label>
              <input
                id="revQty"
                inputmode="decimal"
                bind:value={entryQuantity}
                placeholder="مثلاً ۲۰"
              />
            </div>
            <div class="field">
              <label for="revUnitPrice">فی واحد (اختیاری)</label>
              <input
                id="revUnitPrice"
                inputmode="numeric"
                bind:value={entryUnitPrice}
                placeholder="مثلاً ۳۰۰٬۰۰۰"
              />
            </div>
          </div>

          <div class="field">
            <label for="revItemAmount">
              مبلغ این ردیف <span class="label-unit">تومان</span> <b class="required">*</b>
            </label>
            <div class="input-wrap price-wrap">
              <input
                id="revItemAmount"
                inputmode="numeric"
                bind:value={entryAmount}
                placeholder="مثلاً ۶٬۰۰۰٬۰۰۰"
                required
              />
              <span class="currency">تومان</span>
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn" disabled={isSubmitting}>
            <span>{isSubmitting ? 'در حال ثبت...' : '＋ ثبت ردیف فروش'}</span>
            <span class="btn-arrow">←</span>
          </button>
          <p class="secure-note">
            <span>✓</span> گزارش‌ها و نمودارهای درآمد فقط در پنل مدیریت نمایش داده می‌شوند.
          </p>
        </form>
      {/if}
    </section>
  </div>
</section>
