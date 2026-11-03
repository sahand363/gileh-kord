<script lang="ts">
  import {
    revenues,
    saveDailyTotalRevenue,
    addDetailedRevenueEntry,
    deleteDetailedRevenueEntry,
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
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    calculateRevenueTotal,
    getEffectiveDayRevenue
  } from '../../utils/calculations';
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

  // Daily Total Mode fields
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

  // Find existing record for the selected date
  $: currentDayRecord = $revenues.find((r) => r.date === selectedDate) || null;
  $: effectiveDayAmount = currentDayRecord
    ? getEffectiveDayRevenue(currentDayRecord)
    : 0;

  // Sync form when date changes if a record exists
  let lastSyncedDate = '';
  $: if (selectedDate !== lastSyncedDate) {
    lastSyncedDate = selectedDate;
    const existing = $revenues.find((r) => r.date === selectedDate);
    if (existing) {
      recordingMode = existing.mode;
      dailyTotalAmount = String(existing.dailyTotalAmount || '');
      cardAmount = existing.cardAmount ? String(existing.cardAmount) : '';
      onlineAmount = existing.onlineAmount ? String(existing.onlineAmount) : '';
      cashAmount = existing.cashAmount ? String(existing.cashAmount) : '';
      dailyNotes = existing.notes || '';
    } else {
      dailyTotalAmount = '';
      cardAmount = '';
      onlineAmount = '';
      cashAmount = '';
      dailyNotes = '';
    }
    formError = '';
  }

  // Auto-calculate detailed entry amount when quantity & unitPrice are entered
  $: {
    const q = parseNumericInput(entryQuantity);
    const up = parseNumericInput(entryUnitPrice);
    if (!isNaN(q) && q > 0 && !isNaN(up) && up > 0) {
      entryAmount = String(Math.round(q * up));
    }
  }

  $: totalRecordedRevenue = calculateRevenueTotal($revenues);

  async function handleModeSwitch(mode: RevenueRecordingMode) {
    recordingMode = mode;
    if (currentDayRecord && currentDayRecord.mode !== mode) {
      await switchRevenueDayMode(selectedDate, mode);
      showToast(
        mode === 'daily_total'
          ? 'حالت محاسبه این روز به «مجموع فروش روزانه» تغییر یافت.'
          : 'حالت محاسبه این روز به «ریز تراکنش‌های فروش» تغییر یافت.'
      );
    }
  }

  async function handleSaveDailyTotal() {
    formError = '';
    const total = parseNumericInput(dailyTotalAmount);
    if (isNaN(total) || total <= 0) {
      formError = 'مبلغ کل فروش روزانه باید عددی بزرگ‌تر از صفر باشد.';
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
      showToast(`درآمد روز ${toJalaliDate(selectedDate)} با موفقیت ذخیره شد.`);
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

  async function handleDeleteEntry(entryId: string) {
    await deleteDetailedRevenueEntry(selectedDate, entryId);
    showToast('ردیف فروش حذف شد.');
  }

  async function handleDeleteDayRecord(id: string, date: string) {
    const confirmed = window.confirm(
      `آیا از حذف کامل درآمد ثبت‌شده برای تاریخ ${toJalaliDate(date)} مطمئن هستید؟`
    );
    if (!confirmed) return;
    await deleteRevenueDayRecord(id);
    showToast('رکورد درآمد روز حذف شد.');
  }
</script>

<section class="page active" aria-labelledby="revenueTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">ثبت فروش روزانه و ریز تراکنش‌های درآمدی (شمسی)</p>
      <h1 id="revenueTitle">مدیریت درآمد رستوران</h1>
      <p class="subheading">
        فروش هر روز را به یکی از دو روش «مجموع فروش روزانه» یا «ریز تراکنش‌ها» ثبت کنید (جلوگیری خودکار از دوباره‌شماری).
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

      <!-- Mode Selector (Prevents Double Counting) -->
      <div class="mode-switch-box" style="margin-bottom: 18px;">
        <div style="font-size: 11px; font-weight: 700; margin-bottom: 8px; color: var(--ink);">
          شیوه ثبت و محاسبه درآمد برای تاریخ {getPersianWeekdayName(selectedDate)} {toJalaliDate(selectedDate)}:
        </div>
        <div class="setting-actions">
          <button
            type="button"
            class={recordingMode === 'daily_total' ? 'secondary-btn' : 'quiet-btn'}
            on:click={() => handleModeSwitch('daily_total')}
          >
            {recordingMode === 'daily_total' ? '● ' : '○ '}
            حالت الف: ثبت مجموع فروش روزانه (یکجا)
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
        <small class="field-hint">
          برای جلوگیری از دوباره‌شماری، در هر تاریخ فقط حالت فعال بالا در محاسبات مالی لحاظ می‌شود.
        </small>
      </div>

      {#if recordingMode === 'daily_total'}
        <form on:submit|preventDefault={handleSaveDailyTotal} novalidate>
          <div class="field">
            <label for="dailyRevTotal">
              مجموع فروش روزانه <span class="label-unit">تومان</span> <b class="required">*</b>
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
              <label for="revCard">فروش کارت‌خوان (اختیاری)</label>
              <input
                id="revCard"
                inputmode="numeric"
                bind:value={cardAmount}
                placeholder="مثلاً ۱۴٬۲۰۰٬۰۰۰"
              />
            </div>
            <div class="field">
              <label for="revOnline">فروش آنلاین (اختیاری)</label>
              <input
                id="revOnline"
                inputmode="numeric"
                bind:value={onlineAmount}
                placeholder="مثلاً ۳٬۵۰۰٬۰۰۰"
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
                placeholder="مثلاً ۸۰۰٬۰۰۰"
              />
            </div>
            <div class="field">
              <label for="revDailyNotes">توضیحات روز</label>
              <input
                id="revDailyNotes"
                bind:value={dailyNotes}
                placeholder="مثلاً فروش ناهار و شام..."
              />
            </div>
          </div>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn">
            <span>ذخیره مجموع درآمد روز</span>
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
              placeholder="مثلاً فروش چلوکباب سالن یا سفارش بیرون‌بر..."
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
            <span>＋ افزودن به ریز فروش این روز</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>

        {#if currentDayRecord && currentDayRecord.entries.length > 0}
          <div style="margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line);">
            <strong style="font-size: 11px; display: block; margin-bottom: 8px;">
              ریز اقلام ثبت‌شده برای {toJalaliDate(selectedDate)} (جمع خودکار: {formatMoney(effectiveDayAmount)} تومان):
            </strong>
            <div class="purchase-list">
              {#each currentDayRecord.entries as item (item.id)}
                <div class="purchase-item" style="padding: 9px 12px;">
                  <div class="purchase-main">
                    <div class="purchase-name">
                      <span>{item.description}</span>
                      <span class="badge-employee">{item.category}</span>
                    </div>
                    <div class="purchase-meta">
                      {#if item.quantity}
                        <span>تعداد: {formatNumber(item.quantity)}</span>
                      {/if}
                      {#if item.paymentMethod}
                        <span>روش: {item.paymentMethod}</span>
                      {/if}
                    </div>
                  </div>
                  <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
                    <span class="purchase-amount">{formatMoney(item.amount)} تومان</span>
                    <button
                      type="button"
                      class="quiet-btn"
                      on:click={() => handleDeleteEntry(item.id)}
                    >
                      حذف
                    </button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/if}
    </section>

    <aside class="side-column">
      <section class="panel insight-card">
        <div class="card-topline">
          <span class="mini-icon">↗</span>
          <span>درآمد مؤثر روز انتخابی ({toJalaliDate(selectedDate)})</span>
        </div>
        <div class="stat-number">
          {formatMoney(effectiveDayAmount)} <small>تومان</small>
        </div>
        <p class="stat-caption">
          حالت فعال روز:
          <strong>
            {currentDayRecord
              ? currentDayRecord.mode === 'daily_total'
                ? 'مجموع فروش روزانه (یکجا)'
                : `ریز تراکنش‌ها (${formatNumber(currentDayRecord.entries.length)} ردیف)`
              : 'هنوز ثبت نشده'}
          </strong>
        </p>
        <div class="stat-divider"></div>
        <div class="stat-foot">
          <span>مجموع کل درآمدهای ثبت‌شده</span>
          <strong>{formatMoney(totalRecordedRevenue)} تومان</strong>
        </div>
      </section>

      <section class="tip-card">
        <span class="tip-icon">✳</span>
        <div>
          <strong>جلوگیری از دوباره‌شماری درآمد</strong>
          <p>
            هر روز تقویمی فقط یک حالت فعال («مجموع روزانه» یا «ریز تراکنش‌ها») دارد تا درآمد یک روز دو بار جمع زده نشود. تحلیل‌های جامع سود و زیان در «پنل مدیریت» در دسترس است.
          </p>
        </div>
      </section>
    </aside>
  </div>

  <section class="recent-section">
    <div class="section-heading">
      <div>
        <h2>فهرست روزهای دارای ثبت درآمد</h2>
        <p>برای مشاهده یا ویرایش هر روز، روی دکمه «انتخاب و ویرایش» کلیک کنید</p>
      </div>
    </div>

    <div class="purchase-list">
      {#if $revenues.length > 0}
        {#each $revenues as rev (rev.id)}
          {@const dayTotal = getEffectiveDayRevenue(rev)}
          <article class="purchase-item" style="flex-wrap: wrap;">
            <div class="product-avatar">₿</div>
            <div class="purchase-main">
              <div class="purchase-name">
                <span>
                  {getPersianWeekdayName(rev.date)} {toJalaliDate(rev.date)} ({toJalaliNumeric(rev.date)})
                </span>
                <span class="badge-employee">
                  {rev.mode === 'daily_total'
                    ? 'ثبت مجموع روزانه'
                    : `ریز تراکنش‌ها (${formatNumber(rev.entries.length)} مورد)`}
                </span>
                {#if rev.isDemo}
                  <span class="badge-demo">نمونه آزمایشی</span>
                {:else}
                  <span class="badge-real">ثبت واقعی</span>
                {/if}
              </div>
              <div class="purchase-meta">
                {#if rev.cardAmount}
                  <span>کارت‌خوان: {formatMoney(rev.cardAmount)}</span>
                {/if}
                {#if rev.onlineAmount}
                  <span>آنلاین: {formatMoney(rev.onlineAmount)}</span>
                {/if}
                {#if rev.cashAmount}
                  <span>نقدی: {formatMoney(rev.cashAmount)}</span>
                {/if}
                {#if rev.notes}
                  <span>({rev.notes})</span>
                {/if}
              </div>
            </div>
            <div class="purchase-side" style="display: flex; align-items: center; gap: 8px;">
              <div class="purchase-amount">{formatMoney(dayTotal)} تومان</div>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => (selectedDate = rev.date)}
              >
                انتخاب و ویرایش
              </button>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => handleDeleteDayRecord(rev.id, rev.date)}
              >
                حذف
              </button>
            </div>
          </article>
        {/each}
      {:else}
        <EmptyState
          title="هنوز درآمدی ثبت نشده است"
          message="از فرم بالا فروش روزانه رستوران را ثبت کنید."
        />
      {/if}
    </div>
  </section>
</section>
