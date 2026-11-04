<script lang="ts">
  import {
    revenues,
    publicRevenueStore,
    saveDailyTotalRevenue,
    addDetailedRevenueEntry,
    switchRevenueDayMode,
    deleteRevenueDayRecord
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    getTodayISODate,
    parseNumericInput,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import {
    formatJalaliYearMonthLabel,
    getPersianWeekdayName
  } from '../../utils/jalali';
  import {
    REVENUE_CATEGORIES,
    type PaymentMethod,
    type RevenueCategory,
    type RevenueRecordingMode
  } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

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

  $: currentDayRecord = $revenues.find((r) => r.date === selectedDate) || null;
  $: publicDayItem =
    $publicRevenueStore.dailySeries.find((d) => d.date === selectedDate) || null;
  $: publicDayAmount = publicDayItem ? publicDayItem.amount : 0;

  $: dailyColumnItems = [...$publicRevenueStore.dailySeries]
    .slice(0, 10)
    .reverse()
    .map(
      (d): ColumnChartItem => ({
        id: d.id,
        label: getPersianWeekdayName(d.date),
        subLabel: toJalaliNumeric(d.date).slice(5),
        value: d.amount,
        tone: 'primary'
      })
    );

  $: monthlyColumnItems = [...$publicRevenueStore.monthlySeries]
    .reverse()
    .map(
      (m): ColumnChartItem => ({
        id: m.ym,
        label: formatJalaliYearMonthLabel(m.ym),
        subLabel: `${m.days} روز`,
        value: m.amount,
        tone: 'gold'
      })
    );

  $: {
    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(up) && up > 0) {
      entryAmount = String(Math.round(q * up));
    }
  }

  async function handleModeSwitch(mode: RevenueRecordingMode) {
    recordingMode = mode;
    if (currentDayRecord && currentDayRecord.mode !== mode) {
      await switchRevenueDayMode(selectedDate, mode);
      showToast(
        mode === 'daily_total'
          ? 'حالت ثبت این روز به «مجموع فروش روزانه» تغییر یافت.'
          : 'حالت ثبت این روز به «ریز تراکنش‌های فروش» تغییر یافت.'
      );
    }
  }

  async function handleSaveDailyTotal() {
    formError = '';
    const total = parseNumericInput(dailyTotalAmount);
    if (isNaN(total) || total <= 0) {
      formError = 'مبلغ فروش روزانه باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    const card = parseNumericInput(cardAmount);
    const online = parseNumericInput(onlineAmount);
    const cash = parseNumericInput(cashAmount);

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
      showToast(`درآمد روز ${toJalaliDate(selectedDate)} ثبت شد.`);
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ثبت درآمد روزانه.';
    }
  }

  async function handleAddDetailedItem() {
    formError = '';
    const amount = parseNumericInput(entryAmount);
    if (isNaN(amount) || amount <= 0) {
      formError = 'مبلغ تراکنش فروش باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);

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
      showToast('ردیف فروش اضافه شد.');
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در افزودن ردیف درآمد.';
    }
  }

  async function handleDeleteDayRecord(id: string, date: string) {
    const confirmed = window.confirm(
      `آیا از حذف درآمد ثبت‌شده برای تاریخ ${toJalaliDate(date)} مطمئن هستید؟`
    );
    if (!confirmed) return;
    await deleteRevenueDayRecord(id);
    showToast('رکورد درآمد روز حذف شد.');
  }
</script>

<section class="page active" aria-labelledby="revenueTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">ثبت و نمودار ستونی درآمد (شمسی)</p>
      <h1 id="revenueTitle">درآمد</h1>
      <p class="subheading">ثبت فروش روزانه و مشاهده نمودار ستونی درآمد.</p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel form-panel">
      <div class="field">
        <label for="revDate">تاریخ ثبت درآمد (شمسی)</label>
        <JalaliDatePicker
          id="revDate"
          bind:value={selectedDate}
          ariaLabel="تاریخ ثبت درآمد"
        />
      </div>

      <div class="mode-switch-box" style="margin-bottom: 16px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px;">
          شیوه ثبت برای {getPersianWeekdayName(selectedDate)} {toJalaliDate(selectedDate)}:
        </div>
        <div class="setting-actions">
          <button
            type="button"
            class={recordingMode === 'daily_total' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => handleModeSwitch('daily_total')}
          >
            {recordingMode === 'daily_total' ? '● ' : '○ '}
            مجموع فروش روزانه
          </button>
          <button
            type="button"
            class={recordingMode === 'detailed' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => handleModeSwitch('detailed')}
          >
            {recordingMode === 'detailed' ? '● ' : '○ '}
            ریز تراکنش‌ها
          </button>
        </div>
      </div>

      {#if recordingMode === 'daily_total'}
        <form on:submit|preventDefault={handleSaveDailyTotal} novalidate>
          <div class="field">
            <label for="dailyRevTotal">
              مبلغ فروش روزانه <span class="label-unit">تومان</span> <b class="required">*</b>
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
              <input id="revCard" inputmode="numeric" bind:value={cardAmount} placeholder="مبلغ کارت‌خوان" />
            </div>
            <div class="field">
              <label for="revOnline">آنلاین (اختیاری)</label>
              <input id="revOnline" inputmode="numeric" bind:value={onlineAmount} placeholder="مبلغ آنلاین" />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revCash">نقدی (اختیاری)</label>
              <input id="revCash" inputmode="numeric" bind:value={cashAmount} placeholder="مبلغ نقدی" />
            </div>
            <div class="field">
              <label for="revDailyNotes">توضیحات</label>
              <input id="revDailyNotes" bind:value={dailyNotes} placeholder="توضیحات..." />
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn">
            <span>ثبت درآمد روز</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      {:else}
        <form on:submit|preventDefault={handleAddDetailedItem} novalidate>
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
            <input id="revDesc" bind:value={entryDescription} placeholder="شرح فروش..." />
          </div>

          <div class="field-row">
            <div class="field">
              <label for="revQty">تعداد (اختیاری)</label>
              <input id="revQty" inputmode="decimal" bind:value={entryQuantity} placeholder="مثلاً ۲۰" />
            </div>
            <div class="field">
              <label for="revUnitPrice">فی واحد (اختیاری)</label>
              <input id="revUnitPrice" inputmode="numeric" bind:value={entryUnitPrice} placeholder="مثلاً ۳۰۰٬۰۰۰" />
            </div>
          </div>

          <div class="field">
            <label for="revItemAmount">
              مبلغ کل این ردیف <span class="label-unit">تومان</span> <b class="required">*</b>
            </label>
            <div class="input-wrap price-wrap">
              <input id="revItemAmount" inputmode="numeric" bind:value={entryAmount} placeholder="مثلاً ۶٬۰۰۰٬۰۰۰" required />
              <span class="currency">تومان</span>
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn">
            <span>＋ افزودن به درآمد این روز</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      {/if}
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">↗</span>
          <span>درآمد ({toJalaliDate(selectedDate)})</span>
        </div>
        <div class="stat-number">
          {formatMoney(publicDayAmount)} <small>تومان</small>
        </div>
        <p class="stat-caption">
          درآمد امروز: <strong>{formatMoney($publicRevenueStore.todayAmount)} تومان</strong>
        </p>
        <div class="stat-divider"></div>
        <div class="stat-foot">
          <span>درآمد کل دوره</span>
          <strong>{formatMoney($publicRevenueStore.totalAmount)} تومان</strong>
        </div>
      </section>

      <section class="tip-card">
        <span class="tip-icon">✳</span>
        <div>
          <strong>نمودارهای ستونی درآمد</strong>
          <p>درآمد هر روز پس از ثبت، به‌صورت خودکار در نمودارهای ستونی روزانه و ماهانه پایین صفحه نمایش داده می‌شود.</p>
        </div>
      </section>
    </aside>
  </div>

  <!-- Public Vertical Column Charts: Labeled simply "درآمد" -->
  <div class="two-col-grid" style="margin-top: 20px;">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>درآمد</h2>
          <p>نمودار ستونی روزانه (شمسی)</p>
        </div>
      </div>

      {#if dailyColumnItems.length > 0}
        <ColumnChart items={dailyColumnItems} height={190} />
      {:else}
        <EmptyState title="درآمدی ثبت نشده است" message="از فرم بالا درآمد روزانه را ثبت کنید." />
      {/if}
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>درآمد ماهانه</h2>
          <p>نمودار ستونی ماه‌های شمسی</p>
        </div>
      </div>

      {#if monthlyColumnItems.length > 0}
        <ColumnChart items={monthlyColumnItems} height={190} />
      {:else}
        <EmptyState title="داده ماهانه‌ای وجود ندارد" message="پس از ثبت درآمد، نمودار ماهانه تکمیل می‌شود." />
      {/if}
    </section>
  </div>

  <section class="recent-section">
    <div class="section-heading">
      <div>
        <h2>فهرست روزهای ثبت‌شده</h2>
        <p>خلاصه درآمد به تفکیک تاریخ شمسی</p>
      </div>
    </div>

    <div class="purchase-list">
      {#if $publicRevenueStore.dailySeries.length > 0}
        {#each $publicRevenueStore.dailySeries as item (item.id)}
          <article class="purchase-item" style="flex-wrap: wrap;">
            <div class="product-avatar">₿</div>
            <div class="purchase-main">
              <div class="purchase-name">
                <span>
                  {getPersianWeekdayName(item.date)} {toJalaliDate(item.date)} ({toJalaliNumeric(item.date)})
                </span>
                {#if item.isDemo}
                  <span class="badge-demo">نمونه آزمایشی</span>
                {:else}
                  <span class="badge-real">ثبت واقعی</span>
                {/if}
              </div>
              <div class="purchase-meta">
                <span>درآمد</span>
              </div>
            </div>
            <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
              <div class="purchase-amount">{formatMoney(item.amount)} تومان</div>
              <button type="button" class="quiet-btn" on:click={() => (selectedDate = item.date)}>
                انتخاب
              </button>
              <button type="button" class="quiet-btn" on:click={() => handleDeleteDayRecord(item.id, item.date)}>
                حذف
              </button>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState title="هنوز درآمدی ثبت نشده است" message="از فرم بالا درآمد روزانه رستوران را ثبت کنید." />
      {/if}
    </div>
  </section>
</section>
