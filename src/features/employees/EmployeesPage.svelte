<script lang="ts">
  import {
    employees,
    purchases,
    timesheets,
    addEmployee,
    updateEmployee,
    toggleEmployeeActive
  } from '../../stores/purchaseStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    parseNumericInput,
    toJalaliDate,
    toJalaliDateTime,
    toJalaliNumeric
  } from '../../utils/formatters';
  import {
    formatJalaliYearMonthLabel,
    getPersianWeekdayName
  } from '../../utils/jalali';
  import {
    calculateEmployeePurchaseAnalytics,
    compareEmployeePurchaseTotals
  } from '../../utils/calculations';
  import {
    calculateEmployeeTimesheetSummary,
    createDefaultWeeklySchedule,
    formatMinutesToPersianHours
  } from '../../utils/timesheetUtils';
  import {
    PERSIAN_WEEKDAYS,
    type Employee,
    type PersianWeekdayIndex,
    type WeeklyExpectedSchedule
  } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  let searchQuery = '';
  let statusFilter: 'all' | 'active' | 'inactive' = 'all';

  // Selected employee for Detail & Analytics View
  let selectedEmployeeId: string | null = null;
  let analyticsDateFrom = '';
  let analyticsDateTo = '';

  // Add / Edit Employee Form state
  let editingEmployeeId: string | null = null;
  let name = '';
  let role = 'مسئول خرید';
  let phone = '';
  let notes = '';
  let isActive = true;
  let performanceCoefficient = '1.0';
  let scheduleEnabled = false;
  let expectedSchedule: WeeklyExpectedSchedule = createDefaultWeeklySchedule(false);
  let formError = '';

  const weekdayIndices: PersianWeekdayIndex[] = [0, 1, 2, 3, 4, 5, 6];

  $: filteredEmployees = $employees.filter((emp) => {
    const q = searchQuery.trim().toLocaleLowerCase('fa-IR');
    const matchesSearch =
      !q ||
      emp.name.toLocaleLowerCase('fa-IR').includes(q) ||
      emp.role.toLocaleLowerCase('fa-IR').includes(q) ||
      (emp.phone && emp.phone.includes(q));
    const matchesStatus =
      statusFilter === 'all' ||
      (statusFilter === 'active' && emp.isActive) ||
      (statusFilter === 'inactive' && !emp.isActive);
    return matchesSearch && matchesStatus;
  });

  $: selectedEmployee =
    selectedEmployeeId
      ? $employees.find((e) => e.id === selectedEmployeeId) || null
      : null;

  $: selectedAnalytics = selectedEmployee
    ? calculateEmployeePurchaseAnalytics(
        $purchases,
        selectedEmployee.id,
        analyticsDateFrom,
        analyticsDateTo
      )
    : null;

  $: selectedTimesheetSummary = selectedEmployee
    ? calculateEmployeeTimesheetSummary(
        $timesheets.filter(
          (t) =>
            t.employeeId === selectedEmployee.id &&
            (!analyticsDateFrom || t.date >= analyticsDateFrom) &&
            (!analyticsDateTo || t.date <= analyticsDateTo)
        ),
        selectedEmployee
      )
    : null;

  $: allEmployeeComparisons = compareEmployeePurchaseTotals(
    $purchases,
    $employees,
    analyticsDateFrom,
    analyticsDateTo
  );
  $: maxComparisonAmount =
    allEmployeeComparisons.length > 0 && allEmployeeComparisons[0].totalAmount > 0
      ? allEmployeeComparisons[0].totalAmount
      : 1;

  function resetForm() {
    editingEmployeeId = null;
    name = '';
    role = 'مسئول خرید';
    phone = '';
    notes = '';
    isActive = true;
    performanceCoefficient = '1.0';
    scheduleEnabled = false;
    expectedSchedule = createDefaultWeeklySchedule(false);
    formError = '';
  }

  function startEditEmployee(emp: Employee) {
    editingEmployeeId = emp.id;
    name = emp.name;
    role = emp.role;
    phone = emp.phone || '';
    notes = emp.notes || '';
    isActive = emp.isActive;
    performanceCoefficient = String(emp.performanceCoefficient ?? 1.0);
    if (emp.expectedSchedule) {
      expectedSchedule = JSON.parse(JSON.stringify(emp.expectedSchedule));
      scheduleEnabled = Object.values(expectedSchedule).some((d) => d.enabled);
    } else {
      expectedSchedule = createDefaultWeeklySchedule(false);
      scheduleEnabled = false;
    }
    formError = '';
  }

  async function handleSaveEmployee() {
    formError = '';
    if (!name.trim()) {
      formError = 'لطفاً نام کارمند را وارد کنید.';
      return;
    }

    const parsedCoeff = parseNumericInput(performanceCoefficient);
    if (isNaN(parsedCoeff) || parsedCoeff <= 0 || parsedCoeff > 10) {
      formError = 'ضریب عملکرد باید عددی مثبت (مثلاً ۱.۰ یا ۱.۲) باشد.';
      return;
    }

    const finalSchedule = scheduleEnabled
      ? expectedSchedule
      : createDefaultWeeklySchedule(false);

    try {
      if (editingEmployeeId) {
        await updateEmployee(editingEmployeeId, {
          name,
          role,
          phone,
          notes,
          isActive,
          performanceCoefficient: parsedCoeff,
          expectedSchedule: finalSchedule
        });
        showToast('اطلاعات کارمند با موفقیت بروزرسانی شد.');
      } else {
        await addEmployee({
          name,
          role,
          phone,
          notes,
          isActive,
          performanceCoefficient: parsedCoeff,
          expectedSchedule: finalSchedule
        });
        showToast('کارمند جدید با موفقیت ثبت شد.');
      }
      resetForm();
    } catch (err) {
      formError = err instanceof Error ? err.message : 'خطا در ذخیره اطلاعات کارمند.';
    }
  }

  async function handleToggleActive(emp: Employee) {
    await toggleEmployeeActive(emp.id);
    showToast(
      emp.isActive
        ? `وضعیت «${emp.name}» به غیرفعال تغییر یافت (سوابق حفظ شد).`
        : `وضعیت «${emp.name}» مجدداً فعال شد.`
    );
  }
</script>

<section class="page active" aria-labelledby="employeesTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">مدیریت پرسنل، برنامه کاری و تحلیل خریدهای هر کارمند</p>
      <h1 id="employeesTitle">کارکنان رستوران</h1>
      <p class="subheading">
        برای مشاهده ریز خریدها، آمار تحلیلی و ساعات کاری هر نفر، روی نام کارمند یا دکمه «تحلیل و سوابق» کلیک کنید.
      </p>
    </div>
    {#if selectedEmployee}
      <button
        type="button"
        class="secondary-btn"
        on:click={() => (selectedEmployeeId = null)}
      >
        ← بازگشت به فهرست همه کارکنان
      </button>
    {/if}
  </div>

  {#if selectedEmployee && selectedAnalytics}
    <!-- Employee Detail & Purchase Analytics View -->
    <div class="panel card-pad" style="margin-bottom: 18px;">
      <div class="section-heading" style="flex-wrap: wrap;">
        <div>
          <span class="eyebrow">پرونده اختصاصی و تحلیل عملکرد خرید</span>
          <h2>
            {selectedEmployee.name} — <small style="color: var(--muted);">{selectedEmployee.role}</small>
          </h2>
          <p>
            شناسه یکتا: {selectedEmployee.id}
            | وضعیت: {selectedEmployee.isActive ? 'فعال' : 'غیرفعال'}
            | ضریب عملکرد آتی: {formatNumber(selectedEmployee.performanceCoefficient)}
            {selectedEmployee.phone ? ` | تلفن: ${selectedEmployee.phone}` : ''}
          </p>
        </div>

        <div class="filters">
          <div class="date-filter">
            <span>از تاریخ (شمسی)</span>
            <div class="date-picker-filter-wrap">
              <JalaliDatePicker
                id="empAnalyticsFrom"
                bind:value={analyticsDateFrom}
                placeholder="ابتدای دوره"
                allowEmpty={true}
                ariaLabel="از تاریخ شمسی"
              />
            </div>
          </div>
          <div class="date-filter">
            <span>تا تاریخ (شمسی)</span>
            <div class="date-picker-filter-wrap">
              <JalaliDatePicker
                id="empAnalyticsTo"
                bind:value={analyticsDateTo}
                placeholder="انتهای دوره"
                allowEmpty={true}
                ariaLabel="تا تاریخ شمسی"
              />
            </div>
          </div>
          {#if analyticsDateFrom || analyticsDateTo}
            <button
              type="button"
              class="quiet-btn"
              on:click={() => {
                analyticsDateFrom = '';
                analyticsDateTo = '';
              }}
            >
              پاک کردن بازه
            </button>
          {/if}
        </div>
      </div>

      <div class="kpi-grid" style="margin-top: 14px; margin-bottom: 8px;">
        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">▤</span>
            <span>تعداد کل خریدها</span>
          </div>
          <div class="kpi-value">
            {formatNumber(selectedAnalytics.totalPurchasesCount)} <small>فاکتور</small>
          </div>
          <div class="kpi-sub">
            {formatNumber(selectedAnalytics.distinctProductsCount)} قلم کالای متفاوت
          </div>
        </div>

        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">↗</span>
            <span>مجموع مبلغ خرید</span>
          </div>
          <div class="kpi-value">
            {formatMoney(selectedAnalytics.totalPurchasedAmount)} <small>تومان</small>
          </div>
          <div class="kpi-sub">
            میانگین هر خرید: {formatMoney(selectedAnalytics.averagePurchaseAmount)} تومان
          </div>
        </div>

        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">▦</span>
            <span>آخرین خرید ثبت‌شده</span>
          </div>
          <div class="kpi-value" style="font-size: 15px;">
            {#if selectedAnalytics.mostRecentPurchase}
              {selectedAnalytics.mostRecentPurchase.productName}
            {:else}
              ثبت نشده
            {/if}
          </div>
          <div class="kpi-sub">
            {#if selectedAnalytics.mostRecentPurchase}
              {getPersianWeekdayName(selectedAnalytics.mostRecentPurchase.purchaseDate)}
              {toJalaliDate(selectedAnalytics.mostRecentPurchase.purchaseDate)}
            {:else}
              بدون سابقه در این بازه
            {/if}
          </div>
        </div>

        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">◫</span>
            <span>مجموع ساعت کار ثبت‌شده</span>
          </div>
          <div class="kpi-value" style="font-size: 16px;">
            {selectedTimesheetSummary
              ? formatMinutesToPersianHours(selectedTimesheetSummary.totalWorkingMinutes)
              : '۰ دقیقه'}
          </div>
          <div class="kpi-sub">
            در {formatNumber(selectedTimesheetSummary?.workingDaysCount || 0)} روز کاری
          </div>
        </div>
      </div>
    </div>

    <div class="two-col-grid" style="margin-bottom: 18px;">
      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>بیشترین اقلام خریداری‌شده توسط {selectedEmployee.name}</h2>
            <p>رتبه‌بندی بر اساس دفعات تکرار و حجم ریالی خرید</p>
          </div>
        </div>

        {#if selectedAnalytics.topProducts.length > 0}
          {#each selectedAnalytics.topProducts as prod (prod.productName)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>{prod.productName} ({formatNumber(prod.count)} مرتبه)</strong>
                <span>{formatMoney(prod.totalAmount)} تومان</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    8,
                    Math.round(
                      (prod.totalAmount /
                        Math.max(1, selectedAnalytics.topProducts[0].totalAmount)) *
                        100
                    )
                  )}%;"
                ></div>
              </div>
            </div>
          {/each}
        {:else}
          <EmptyState
            title="خریدی برای این کارمند ثبت نشده است"
            message="با ثبت خرید به نام این کارمند، اقلام پرتکرار اینجا نمایش داده می‌شوند."
          />
        {/if}
      </section>

      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>فعالیت خرید ماهانه (شمسی)</h2>
            <p>روند حجم خرید کارمند به تفکیک ماه‌های شمسی</p>
          </div>
        </div>

        {#if selectedAnalytics.monthlyActivity.length > 0}
          {#each selectedAnalytics.monthlyActivity as m (m.jalaliMonthKey)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>
                  {formatJalaliYearMonthLabel(m.jalaliMonthKey)} ({formatNumber(m.count)} خرید)
                </strong>
                <span>{formatMoney(m.totalAmount)} تومان</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    8,
                    Math.round(
                      (m.totalAmount /
                        Math.max(1, selectedAnalytics.monthlyActivity[0].totalAmount)) *
                        100
                    )
                  )}%;"
                ></div>
              </div>
            </div>
          {/each}
        {:else}
          <EmptyState
            title="سابقه ماهانه‌ای وجود ندارد"
            message="پس از ثبت خرید، نمودار ماهانه تکمیل می‌شود."
          />
        {/if}
      </section>
    </div>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>جدول کامل تاریخچه خریدهای {selectedEmployee.name}</h2>
          <p>شامل تاریخ شمسی، روز هفته دقیق، مقدار، مبلغ، فروشنده و شماره فاکتور</p>
        </div>
      </div>

      {#if selectedAnalytics.purchases.length > 0}
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>تاریخ شمسی</th>
                <th>روز هفته</th>
                <th>نام محصول</th>
                <th>مقدار</th>
                <th>مبلغ کل (تومان)</th>
                <th>فروشنده / فاکتور</th>
                <th>توضیحات / زمان ثبت</th>
              </tr>
            </thead>
            <tbody>
              {#each selectedAnalytics.purchases as p (p.id)}
                <tr>
                  <td>
                    <strong>{toJalaliNumeric(p.purchaseDate)}</strong>
                    <small style="display: block; color: var(--muted);">
                      {toJalaliDate(p.purchaseDate)}
                    </small>
                  </td>
                  <td>{getPersianWeekdayName(p.purchaseDate)}</td>
                  <td>
                    <strong>{p.productName}</strong>
                    {#if p.isDemo}
                      <span class="badge-demo">نمونه</span>
                    {/if}
                  </td>
                  <td>{formatNumber(p.quantity)} {p.unit}</td>
                  <td><strong>{formatMoney(p.totalAmount)}</strong></td>
                  <td>
                    {p.supplierName || '—'}
                    {p.invoiceNumber ? ` (فاکتور ${p.invoiceNumber})` : ''}
                  </td>
                  <td>
                    {p.notes || '—'}
                    {#if p.createdAt}
                      <small style="display: block; color: var(--muted); font-size: 9px;">
                        {toJalaliDateTime(p.createdAt)}
                      </small>
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <EmptyState
          title="خریدی در این بازه زمانی یافت نشد"
          message="بازه تاریخ را تغییر دهید یا خرید جدیدی به نام این کارمند ثبت کنید."
        />
      {/if}
    </section>
  {:else}
    <!-- Main Employees Directory + Add/Edit Form + Comparison Chart -->
    <div class="entry-layout">
      <section class="panel history-panel">
        <div class="filters">
          <div class="search-box">
            <span>⌕</span>
            <input
              bind:value={searchQuery}
              placeholder="جست‌وجوی نام کارمند، سمت یا تلفن..."
              aria-label="جست‌وجوی کارمند"
            />
          </div>
          <select
            bind:value={statusFilter}
            style="width: auto; min-width: 140px; height: 42px; font-size: 11px;"
            aria-label="فیلتر وضعیت کارمند"
          >
            <option value="all">همه کارکنان</option>
            <option value="active">فقط فعال</option>
            <option value="inactive">فقط غیرفعال</option>
          </select>
        </div>

        <div class="history-summary">
          <span>تعداد کارکنان: <strong>{formatNumber(filteredEmployees.length)} نفر</strong></span>
          <span>برای مشاهده ریز خریدهای هر نفر روی نام او کلیک کنید</span>
        </div>

        <div class="purchase-list">
          {#if filteredEmployees.length > 0}
            {#each filteredEmployees as emp (emp.id)}
              {@const empStats = calculateEmployeePurchaseAnalytics($purchases, emp.id)}
              <article class="purchase-item" style="flex-wrap: wrap;">
                <div class="product-avatar">{emp.name.charAt(0)}</div>
                <div class="purchase-main">
                  <div class="purchase-name">
                    <button
                      type="button"
                      class="emp-link-btn"
                      on:click={() => (selectedEmployeeId = emp.id)}
                    >
                      {emp.name}
                    </button>
                    <span class="badge-employee">{emp.role}</span>
                    {#if !emp.isActive}
                      <span class="badge-low">غیرفعال</span>
                    {/if}
                    {#if emp.isDemo}
                      <span class="badge-demo">نمونه آزمایشی</span>
                    {:else}
                      <span class="badge-real">ثبت واقعی</span>
                    {/if}
                  </div>
                  <div class="purchase-meta">
                    <span>تعداد خرید: {formatNumber(empStats.totalPurchasesCount)} فاکتور</span>
                    <span>جمع خرید: {formatMoney(empStats.totalPurchasedAmount)} تومان</span>
                    <span>ضریب عملکرد: {formatNumber(emp.performanceCoefficient)}</span>
                    {#if emp.phone}
                      <span>تلفن: {emp.phone}</span>
                    {/if}
                  </div>
                </div>
                <div class="setting-actions">
                  <button
                    type="button"
                    class="secondary-btn"
                    on:click={() => (selectedEmployeeId = emp.id)}
                  >
                    تحلیل و سوابق خرید
                  </button>
                  <button
                    type="button"
                    class="quiet-btn"
                    on:click={() => startEditEmployee(emp)}
                  >
                    ویرایش
                  </button>
                  <button
                    type="button"
                    class="quiet-btn"
                    on:click={() => handleToggleActive(emp)}
                  >
                    {emp.isActive ? 'غیرفعال‌سازی' : 'فعال‌سازی'}
                  </button>
                </div>
              </article>
            {/each}
          {:else}
            <EmptyState
              title="کارمندی یافت نشد"
              message="از فرم روبه‌رو کارمند جدید اضافه کنید."
            />
          {/if}
        </div>

        <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--line);">
          <div class="section-heading">
            <div>
              <h2>مقایسه حجم خرید کارکنان</h2>
              <p>مجموع خریدهای ثبت‌شده به تفکیک هر مسئول خرید</p>
            </div>
          </div>
          {#each allEmployeeComparisons as cmp (cmp.employeeId)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>
                  {cmp.employeeName} ({cmp.role}) — {formatNumber(cmp.count)} خرید
                </strong>
                <span>{formatMoney(cmp.totalAmount)} تومان</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    5,
                    Math.round((cmp.totalAmount / maxComparisonAmount) * 100)
                  )}%;"
                ></div>
              </div>
            </div>
          {/each}
        </div>
      </section>

      <aside class="panel form-panel">
        <div class="section-heading">
          <div>
            <h2>{editingEmployeeId ? 'ویرایش پرونده کارمند' : 'افزودن کارمند جدید'}</h2>
            <p>تغییر نام کارمند سوابق خرید و تایم‌شیت قبلی او را حفظ می‌کند</p>
          </div>
          {#if editingEmployeeId}
            <button type="button" class="quiet-btn" on:click={resetForm}>
              انصراف
            </button>
          {/if}
        </div>

        <form on:submit|preventDefault={handleSaveEmployee} novalidate>
          <div class="field">
            <label for="empName">نام و نام خانوادگی <b class="required">*</b></label>
            <input
              id="empName"
              bind:value={name}
              placeholder="مثلاً علی رضوانی"
              required
            />
          </div>

          <div class="field-row">
            <div class="field">
              <label for="empRole">سمت / نقش</label>
              <input
                id="empRole"
                bind:value={role}
                placeholder="مثلاً مسئول خرید، آشپز، انباردار"
              />
            </div>
            <div class="field">
              <label for="empPhone">شماره تماس</label>
              <input id="empPhone" bind:value={phone} placeholder="۰۹۱۱..." />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="empCoeff">ضریب عملکرد (جهت سیستم آتی)</label>
              <input
                id="empCoeff"
                inputmode="decimal"
                bind:value={performanceCoefficient}
                placeholder="۱.۰"
              />
              <small class="field-hint">صرفاً جهت ذخیره در پروفایل (بدون محاسبه حقوق فعلی)</small>
            </div>
            <div class="field">
              <label for="empStatus">وضعیت همکاری</label>
              <select id="empStatus" bind:value={isActive}>
                <option value={true}>فعال</option>
                <option value={false}>غیرفعال</option>
              </select>
            </div>
          </div>

          <div class="field">
            <label for="empNotes">توضیحات</label>
            <textarea
              id="empNotes"
              rows="2"
              bind:value={notes}
              placeholder="توضیحات اختیاری درباره مسئولیت‌ها..."
            ></textarea>
          </div>

          <details class="optional-fields" bind:open={scheduleEnabled}>
            <summary>
              <span>برنامه ساعت کاری مورد انتظار (اختیاری)</span>
              <span class="optional-tag">تایم‌شیت</span>
              <span class="chevron">⌄</span>
            </summary>
            <div style="padding: 8px 0; display: grid; gap: 8px;">
              {#each weekdayIndices as wIdx}
                <div style="display: flex; align-items: center; gap: 8px; font-size: 11px;">
                  <input
                    type="checkbox"
                    id={`sched_day_${wIdx}`}
                    bind:checked={expectedSchedule[wIdx].enabled}
                    style="width: 18px; height: 18px;"
                  />
                  <label for={`sched_day_${wIdx}`} style="min-width: 65px; margin: 0;">
                    {PERSIAN_WEEKDAYS[wIdx]}
                  </label>
                  <input
                    type="text"
                    dir="ltr"
                    bind:value={expectedSchedule[wIdx].startTime}
                    disabled={!expectedSchedule[wIdx].enabled}
                    placeholder="08:00"
                    aria-label={`ساعت شروع ${PERSIAN_WEEKDAYS[wIdx]}`}
                    style="height: 32px; font-size: 11px; text-align: center;"
                  />
                  <span>تا</span>
                  <input
                    type="text"
                    dir="ltr"
                    bind:value={expectedSchedule[wIdx].endTime}
                    disabled={!expectedSchedule[wIdx].enabled}
                    placeholder="17:00"
                    aria-label={`ساعت پایان ${PERSIAN_WEEKDAYS[wIdx]}`}
                    style="height: 32px; font-size: 11px; text-align: center;"
                  />
                </div>
              {/each}
            </div>
          </details>

          {#if formError}
            <div class="form-error" role="alert">{formError}</div>
          {/if}

          <button type="submit" class="primary-btn">
            <span>{editingEmployeeId ? 'ذخیره تغییرات کارمند' : 'ثبت کارمند جدید'}</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      </aside>
    </div>
  {/if}
</section>
