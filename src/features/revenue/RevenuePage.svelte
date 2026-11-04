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
    formatNumber,
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

  let selectedDate = getTodayISODate();
  let recordingMode: RevenueRecordingMode = 'daily_total';

  // Daily Total Mode fields (saves unmodified raw values to IndexedDB)
  let dailyTotalAmount = '';
  let cardAmount = '';
  let onlineAmount = '';
  let cashAmount = '';
  let dailyNotes = '';

  // Detailed Entry Mode fields
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

  $: maxDailyChart =
    $publicRevenueStore.dailySeries.length > 0
      ? Math.max(1, ...$publicRevenueStore.dailySeries.map((d) => d.amount))
      : 1;

  $: maxMonthlyChart =
    $publicRevenueStore.monthlySeries.length > 0
      ? Math.max(1, ...$publicRevenueStore.monthlySeries.map((m) => m.amount))
      : 1;

  // Auto-calculate detailed entry amount when quantity & unitPrice are entered
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
      showToast(`درآمد روز ${toJalaliDate(selectedDate)} با موفقیت ثبت شد.`);
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
      showToast('ردیف فروش به درآمد این روز اضافه شد.');
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
      <p class="eyebrow">ثبت و مشاهده درآمد (شمسی)</p>
      <h1 id="revenueTitle">درآمد</h1>
      <p class="subheading">
        ثبت فروش روزانه یا ریز تراکنش‌های فروش و مشاهده نمودار درآمد به تاریخ شمسی.
      </p>
    </div>
  </div>

  <div class="entry-layout">
    <section class="panel form-panel">
      <div class="field">
        <label for="revDate">انتخاب تاریخ ثبت درآمد (شمسی)</label>
        <JalaliDatePicker
          id="revDate"
          bind:value={selectedDate}
          ariaLabel="تاریخ ثبت درآمد"
        />
      </div>

      <div class="mode-switch-box" style="margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px; color: var(--ink);">
          شیوه ثبت درآمد برای تاریخ {getPersianWeekdayName(selectedDate)} {toJalaliDate(selectedDate)}:
        </div>
        <div class="setting-actions">
          <button
            type="button"
            class={recordingMode === 'daily_total' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => handleModeSwitch('daily_total')}
          >
            {recordingMode === 'daily_total' ? '● ' : '○ '}
            حالت الف: ثبت مجموع فروش روزانه
          </button>
          <button
            type="button"
            class={recordingMode === 'detailed' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => handleModeSwitch('detailed')}
          >
            {recordingMode === 'detailed' ? '● ' : '○ '}
            حالت ب: ثبت ریز تراکنش‌های فروش
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
              <input
                id="revCard"
                inputmode="numeric"
                bind:value={cardAmount}
                placeholder="مبلغ کارت‌خوان"
              />
            </div>
            <div class="field">
              <label for="revOnline">فروش آنلاین (اختیاری)</label>
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
              <label for="revCash">دریافتی نقدی (اختیاری)</label>
              <input
                id="revCash"
                inputmode="numeric"
                bind:value={cashAmount}
                placeholder="مبلغ نقدی"
              />
            </div>
            <div class="field">
              <label for="revDailyNotes">توضیحات روز</label>
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
              <label for="revUnitPrice">فی واحد به تومان (اختیاری)</label>
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
              مبلغ کل این ردیف <span class="label-unit">تومان</span> <b class="required">*</b>
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
          <strong>ثبت منظم درآمد روزانه</strong>
          <p>
            درآمد هر روز را به تاریخ شمسی ثبت کنید تا نمودارهای روزانه و ماهانه به‌طور خودکار بروزرسانی شوند.
          </p>
        </div>
      </section>
    </aside>
  </div>

  <!-- Public Daily & Monthly Revenue Charts: Labeled simply "درآمد" -->
  <div class="two-col-grid" style="margin-top: 24px;">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>درآمد</h2>
          <p>روند درآمد روزانه (شمسی)</p>
        </div>
      </div>

      {#if $publicRevenueStore.dailySeries.length > 0}
        {#each $publicRevenueStore.dailySeries as item (item.id)}
          <div class="bar-row">
            <div class="bar-labels">
              <strong>
                {getPersianWeekdayName(item.date)} {toJalaliDate(item.date)} ({toJalaliNumeric(item.date)})
              </strong>
              <span>{formatMoney(item.amount)} تومان</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style="width: {Math.max(
                  6,
                  Math.round((item.amount / maxDailyChart) * 100)
                )}%;"
              ></div>
            </div>
          </div>
        {/each}
      {:else}
        <EmptyState
          title="درآمدی ثبت نشده است"
          message="از فرم بالا درآمد روزانه را ثبت کنید."
        />
      {/if}
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>درآمد ماهانه</h2>
          <p>جمع درآمد به تفکیک ماه‌های شمسی</p>
        </div>
      </div>

      {#if $publicRevenueStore.monthlySeries.length > 0}
        {#each $publicRevenueStore.monthlySeries as m (m.ym)}
          <div class="bar-row">
            <div class="bar-labels">
              <strong>
                {formatJalaliYearMonthLabel(m.ym)} ({formatNumber(m.days)} روز)
              </strong>
              <span>{formatMoney(m.amount)} تومان</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style="width: {Math.max(
                  6,
                  Math.round((m.amount / maxMonthlyChart) * 100)
                )}%;"
              ></div>
            </div>
          </div>
        {/each}
      {:else}
        <EmptyState
          title="داده ماهانه‌ای وجود ندارد"
          message="پس از ثبت درآمد، نمودار ماهانه تکمیل می‌شود."
        />
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
                <span>درآمد روز</span>
              </div>
            </div>
            <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
              <div class="purchase-amount">{formatMoney(item.amount)} تومان</div>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => (selectedDate = item.date)}
              >
                انتخاب تاریخ
              </button>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => handleDeleteDayRecord(item.id, item.date)}
              >
                حذف
              </button>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState
          title="هنوز درآمدی ثبت نشده است"
          message="از فرم بالا درآمد روزانه رستوران را ثبت کنید."
        />
      {/if}
    </div>
  </section>
</section>
