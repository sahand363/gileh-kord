<script lang="ts">
  import { onMount } from 'svelte';
  import {
    managerAuthService,
    isManagerConfigured,
    isManagerUnlocked,
    activeManagerUsername
  } from '../../services/ManagerAuthService';
  import {
    purchases,
    expenses,
    revenues,
    employees,
    timesheets,
    appSettings,
    updateGlobalRevenueCoefficient
  } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
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
    getJalaliYearMonthKey,
    getPersianWeekdayName
  } from '../../utils/jalali';
  import {
    calculateAdjustedRevenueTotal,
    calculateFinancialOverview,
    calculateRevenueTotal,
    compareEmployeePurchaseTotals,
    filterRevenueRecords,
    getAdjustedDayRevenue,
    getEffectiveDayRevenue
  } from '../../utils/calculations';
  import {
    calculateEmployeeTimesheetSummary,
    formatMinutesToPersianHours
  } from '../../utils/timesheetUtils';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';

  // Setup & Login form state
  let usernameInput = 'manager';
  let passwordInput = '';
  let confirmPasswordInput = '';
  let authError = '';

  // Change password drawer state
  let showPasswordChange = false;
  let currentPassInput = '';
  let newPassInput = '';
  let changePassError = '';

  // Global Revenue Coefficient Editor state (Exclusive to Manager Area)
  let coefficientInput = '0.7';
  let coeffError = '';

  // Date filters for Manager Financial Analytics
  let dateFrom = '';
  let dateTo = '';
  let onlyReal = false;

  const todayISO = getTodayISODate();
  const currentJalaliMonthKey = getJalaliYearMonthKey(todayISO);

  function getDaysAgoISO(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return getTodayISODate(d);
  }

  const sevenDaysAgoISO = getDaysAgoISO(6);

  $: activeCoefficient = $appSettings.globalRevenueCoefficient ?? 0.7;

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      usernameInput = $activeManagerUsername;
    }
    coefficientInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
  });

  // Actual vs. Adjusted Revenue KPIs (Today, 7-Day, Month)
  $: todayRecords = filterRevenueRecords($revenues, todayISO, todayISO, onlyReal);
  $: todayActualRevenue = calculateRevenueTotal(todayRecords);
  $: todayAdjustedRevenue = calculateAdjustedRevenueTotal(
    todayRecords,
    activeCoefficient
  );

  $: weekRecords = filterRevenueRecords(
    $revenues,
    sevenDaysAgoISO,
    todayISO,
    onlyReal
  );
  $: weekActualRevenue = calculateRevenueTotal(weekRecords);
  $: weekAdjustedRevenue = calculateAdjustedRevenueTotal(
    weekRecords,
    activeCoefficient
  );

  $: monthRecords = $revenues.filter(
    (r) =>
      (!onlyReal || !r.isDemo) &&
      getJalaliYearMonthKey(r.date) === currentJalaliMonthKey
  );
  $: monthActualRevenue = calculateRevenueTotal(monthRecords);
  $: monthAdjustedRevenue = calculateAdjustedRevenueTotal(
    monthRecords,
    activeCoefficient
  );

  // Selected Period Financial Overview
  $: financialOverview = calculateFinancialOverview({
    revenues: $revenues,
    purchases: $purchases,
    expenses: $expenses,
    coefficient: activeCoefficient,
    dateFrom,
    dateTo,
    onlyReal
  });

  $: maxFinancialBar = Math.max(
    1,
    financialOverview.totalRevenue,
    financialOverview.totalAdjustedRevenue,
    financialOverview.totalPurchases,
    financialOverview.totalOperationalExpenses,
    Math.abs(financialOverview.estimatedNetOperatingBalance)
  );

  // Dual-Series Daily Revenue (Both Actual and Adjusted series)
  $: periodDailyDualSeries = filterRevenueRecords(
    $revenues,
    dateFrom,
    dateTo,
    onlyReal
  )
    .slice(0, 14)
    .map((r) => ({
      id: r.id,
      date: r.date,
      actualAmount: getEffectiveDayRevenue(r),
      adjustedAmount: getAdjustedDayRevenue(r, activeCoefficient)
    }));

  $: maxDailyDualRev =
    periodDailyDualSeries.length > 0
      ? Math.max(
          1,
          ...periodDailyDualSeries.map((d) =>
            Math.max(d.actualAmount, d.adjustedAmount)
          )
        )
      : 1;

  // Dual-Series Monthly Revenue (Both Actual and Adjusted series)
  $: monthlyDualSeries = (() => {
    const map = new Map<
      string,
      { ym: string; actualTotal: number; adjustedTotal: number; days: number }
    >();
    const list = filterRevenueRecords($revenues, dateFrom, dateTo, onlyReal);
    for (const r of list) {
      const ym = getJalaliYearMonthKey(r.date);
      if (!ym) continue;
      const prev = map.get(ym) || {
        ym,
        actualTotal: 0,
        adjustedTotal: 0,
        days: 0
      };
      prev.actualTotal += getEffectiveDayRevenue(r);
      prev.adjustedTotal += getAdjustedDayRevenue(r, activeCoefficient);
      prev.days += 1;
      map.set(ym, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  })();

  $: maxMonthlyDualRev =
    monthlyDualSeries.length > 0
      ? Math.max(
          1,
          ...monthlyDualSeries.map((m) =>
            Math.max(m.actualTotal, m.adjustedTotal)
          )
        )
      : 1;

  // Employee Purchase, Timesheet & Performance Coefficient Overview
  $: employeePurchaseComparisons = compareEmployeePurchaseTotals(
    $purchases.filter((p) => !onlyReal || !p.isDemo),
    $employees,
    dateFrom,
    dateTo
  );

  $: employeeWorkAndCoeffTable = $employees.map((emp) => {
    const empShifts = $timesheets.filter(
      (t) =>
        t.employeeId === emp.id &&
        (!onlyReal || !t.isDemo) &&
        (!dateFrom || t.date >= dateFrom) &&
        (!dateTo || t.date <= dateTo)
    );
    const tsSummary = calculateEmployeeTimesheetSummary(empShifts, emp);
    const purchSummary = employeePurchaseComparisons.find(
      (c) => c.employeeId === emp.id
    );
    const weightedUnits = Number(
      (tsSummary.totalWorkingHoursDecimal * emp.performanceCoefficient).toFixed(2)
    );

    return {
      employee: emp,
      purchasesCount: purchSummary?.count || 0,
      purchasesAmount: purchSummary?.totalAmount || 0,
      workingDays: tsSummary.workingDaysCount,
      workingMinutes: tsSummary.totalWorkingMinutes,
      workingHoursDecimal: tsSummary.totalWorkingHoursDecimal,
      overtimeMinutes: tsSummary.totalOvertimeMinutes,
      lateMinutes: tsSummary.totalLateMinutes,
      weightedUnits
    };
  });

  async function handleSaveGlobalCoefficient() {
    coeffError = '';
    const parsed = parseNumericInput(coefficientInput);
    if (isNaN(parsed) || parsed <= 0 || parsed > 10) {
      coeffError = 'لطفاً ضریب معتبری بزرگ‌تر از صفر (مثلاً ۰.۷) وارد کنید.';
      return;
    }
    try {
      const saved = await updateGlobalRevenueCoefficient(parsed);
      coefficientInput = String(saved.globalRevenueCoefficient);
      showToast(
        'ضریب سراسری درآمد بروزرسانی شد و نمودارهای عمومی به‌طور خودکار هماهنگ شدند.'
      );
    } catch (err) {
      coeffError = err instanceof Error ? err.message : 'خطا در ذخیره ضریب درآمد.';
    }
  }

  async function handleInitialSetup() {
    authError = '';
    if (passwordInput !== confirmPasswordInput) {
      authError = 'رمز عبور و تکرار آن یکسان نیستند.';
      return;
    }
    const res = await managerAuthService.setupInitialAccount(
      usernameInput,
      passwordInput
    );
    if (!res.success) {
      authError = res.error || 'خطا در ایجاد حساب مدیر.';
      return;
    }
    passwordInput = '';
    confirmPasswordInput = '';
    coefficientInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
    showToast('حساب مدیر ایجاد شد و پنل مدیریت باز گردید.');
  }

  async function handleLogin() {
    authError = '';
    const res = await managerAuthService.login(usernameInput, passwordInput);
    if (!res.success) {
      authError = res.error || 'نام کاربری یا رمز عبور نادرست است.';
      return;
    }
    passwordInput = '';
    coefficientInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
    showToast('ورود به پنل مدیریت انجام شد.');
  }

  async function handleChangePassword() {
    changePassError = '';
    const res = await managerAuthService.changePassword(
      currentPassInput,
      newPassInput,
      usernameInput
    );
    if (!res.success) {
      changePassError = res.error || 'خطا در تغییر رمز عبور.';
      return;
    }
    currentPassInput = '';
    newPassInput = '';
    showPasswordChange = false;
    showToast('رمز عبور مدیر با موفقیت تغییر یافت.');
  }

  function handleLockPanel() {
    managerAuthService.lock();
    showToast('پنل مدیریت قفل شد.');
  }
</script>

<section class="page active" aria-labelledby="managerTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">بخش خصوصی مدیریت مالی، ضریب درآمد و عملکرد پرسنل</p>
      <h1 id="managerTitle">پنل مدیریت</h1>
      <p class="subheading">
        مشاهده درآمد واقعی، درآمد تعدیل‌شده، ضریب سراسری درآمد، مانده عملیاتی تخمینی و تحلیل عملکرد کارکنان.
      </p>
    </div>

    {#if $isManagerUnlocked}
      <div class="setting-actions">
        <button
          type="button"
          class="quiet-btn"
          on:click={() => (showPasswordChange = !showPasswordChange)}
        >
          ⚙ تغییر رمز عبور مدیر
        </button>
        <button
          id="adminLogout"
          type="button"
          class="secondary-btn"
          on:click={handleLockPanel}
        >
          ⌑ قفل کردن پنل مدیریت
        </button>
      </div>
    {/if}
  </div>

  {#if !$isManagerConfigured}
    <div class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h2>راه‌اندازی اولیه دسترسی مدیر</h2>
      <p>
        برای محافظت از اطلاعات درآمد واقعی و تنظیمات ضریب درآمد در برابر دید عمومی، یک نام کاربری و رمز عبور محلی تعیین کنید.
      </p>

      <form on:submit|preventDefault={handleInitialSetup} novalidate>
        <div class="field">
          <label for="setupManagerUser">نام کاربری مدیر</label>
          <input
            id="setupManagerUser"
            bind:value={usernameInput}
            placeholder="مثلاً manager"
            autocomplete="username"
            required
          />
        </div>

        <div class="field">
          <label for="setupManagerPass">رمز عبور (حداقل ۴ کاراکتر)</label>
          <input
            id="setupManagerPass"
            type="password"
            bind:value={passwordInput}
            placeholder="رمز عبور دلخواه را وارد کنید"
            autocomplete="new-password"
            required
          />
        </div>

        <div class="field">
          <label for="setupManagerConfirm">تکرار رمز عبور</label>
          <input
            id="setupManagerConfirm"
            type="password"
            bind:value={confirmPasswordInput}
            placeholder="تکرار رمز عبور"
            autocomplete="new-password"
            required
          />
        </div>

        {#if authError}
          <div class="form-error" role="alert">{authError}</div>
        {/if}

        <p class="demo-hint">
          توجه امنیتی شفاف: این قفل یک «محافظ رابط کاربری محلی» در مرورگر است. احراز هویت رمزنگاری‌شده سروری نیازمند بک‌اند Go در فاز بعدی است.
        </p>

        <button type="submit" class="primary-btn">
          <span>ایجاد حساب و ورود به پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else if !$isManagerUnlocked}
    <div id="settingsLogin" class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h2>ورود به پنل مدیریت</h2>
      <p>برای مشاهده درآمد واقعی، ضریب سراسری درآمد و تحلیل‌های مدیریتی وارد شوید.</p>

      <form id="loginForm" on:submit|preventDefault={handleLogin} novalidate>
        <div class="field">
          <label for="adminUser">نام کاربری مدیر</label>
          <input
            id="adminUser"
            bind:value={usernameInput}
            autocomplete="username"
            required
          />
        </div>

        <div class="field">
          <label for="adminPass">رمز عبور</label>
          <input
            id="adminPass"
            type="password"
            bind:value={passwordInput}
            placeholder="رمز عبور مدیر را وارد کنید"
            autocomplete="current-password"
            required
          />
        </div>

        {#if authError}
          <div class="form-error" role="alert">{authError}</div>
        {/if}

        <p class="demo-hint">
          این قفل محلی جهت جداسازی صفحات عمومی از گزارش‌های مدیریتی است. امنیت کامل سروری در فاز بک‌اند Go پیاده‌سازی می‌شود.
        </p>

        <button type="submit" class="primary-btn">
          <span>باز کردن پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else}
    {#if showPasswordChange}
      <div class="panel card-pad" style="margin-bottom: 18px; max-width: 520px;">
        <div class="section-heading">
          <div>
            <h2>تغییر رمز عبور پنل مدیریت</h2>
            <p>کاربر فعلی: {$activeManagerUsername}</p>
          </div>
          <button
            type="button"
            class="quiet-btn"
            on:click={() => (showPasswordChange = false)}
          >
            بستن
          </button>
        </div>

        <form on:submit|preventDefault={handleChangePassword} novalidate>
          <div class="field">
            <label for="mgrCurrentPass">رمز عبور فعلی</label>
            <input
              id="mgrCurrentPass"
              type="password"
              bind:value={currentPassInput}
              required
            />
          </div>
          <div class="field">
            <label for="mgrNewPass">رمز عبور جدید (حداقل ۴ کاراکتر)</label>
            <input
              id="mgrNewPass"
              type="password"
              bind:value={newPassInput}
              required
            />
          </div>
          {#if changePassError}
            <div class="form-error" role="alert">{changePassError}</div>
          {/if}
          <button type="submit" class="primary-btn">
            <span>ذخیره رمز عبور جدید</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      </div>
    {/if}

    <!-- Global Revenue Coefficient Control & Date Filter Bar -->
    <section class="panel card-pad" style="margin-bottom: 18px;">
      <div class="two-col-grid" style="align-items: center;">
        <div>
          <span class="eyebrow">تنظیم محرمانه مدیر</span>
          <h2 style="font-size: 16px; margin: 0 0 4px;">
            ضریب سراسری درآمد: <strong>{formatNumber(activeCoefficient)}</strong>
          </h2>
          <p style="margin: 0; font-size: 11px; color: var(--muted);">
            نمودارهای عمومی برنامه فقط حاصل‌ضرب درآمد در این ضریب را با عنوان ساده «درآمد» نمایش می‌دهند، بدون آنکه رکوردهای اصلی تغییر کنند.
          </p>
        </div>

        <form
          on:submit|preventDefault={handleSaveGlobalCoefficient}
          style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;"
          novalidate
        >
          <label for="globalRevCoeff" style="font-size: 11px; font-weight: 700;">
            ضریب سراسری:
          </label>
          <input
            id="globalRevCoeff"
            inputmode="decimal"
            dir="ltr"
            bind:value={coefficientInput}
            style="width: 110px; height: 40px; text-align: center; font-weight: 700;"
            aria-label="ضریب سراسری درآمد"
          />
          <button type="submit" class="secondary-btn" style="height: 40px;">
            ذخیره ضریب
          </button>
        </form>
      </div>
      {#if coeffError}
        <div class="form-error" role="alert" style="margin-top: 8px; margin-bottom: 0;">
          {coeffError}
        </div>
      {/if}

      <div class="stat-divider" style="margin: 14px 0;"></div>

      <div class="filters">
        <div class="date-filter">
          <span>از تاریخ (شمسی)</span>
          <div class="date-picker-filter-wrap">
            <JalaliDatePicker
              id="mgrDateFrom"
              bind:value={dateFrom}
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
              id="mgrDateTo"
              bind:value={dateTo}
              placeholder="انتهای دوره"
              allowEmpty={true}
              ariaLabel="تا تاریخ شمسی"
            />
          </div>
        </div>

        <button
          type="button"
          class={onlyReal ? 'secondary-btn' : 'quiet-btn'}
          on:click={() => (onlyReal = !onlyReal)}
        >
          {onlyReal ? '✓ فقط داده‌های واقعی' : 'همه داده‌ها (شامل نمونه)'}
        </button>

        {#if dateFrom || dateTo || onlyReal}
          <button
            type="button"
            class="quiet-btn"
            on:click={() => {
              dateFrom = '';
              dateTo = '';
              onlyReal = false;
            }}
          >
            پاک کردن فیلترها
          </button>
        {/if}

        <div style="margin-right: auto; display: flex; gap: 8px;">
          <button type="button" class="secondary-btn" on:click={() => navigateTo('revenue')}>
            ＋ ثبت درآمد جدید
          </button>
        </div>
      </div>
    </section>

    <!-- Actual vs. Adjusted Revenue KPIs -->
    <div class="kpi-grid">
      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">₿</span>
          <span>درآمد امروز ({toJalaliDate(todayISO)})</span>
        </div>
        <div class="kpi-value">{formatMoney(todayActualRevenue)} <small>تومان (واقعی)</small></div>
        <div class="kpi-sub">
          درآمد تعدیل‌شده: <strong>{formatMoney(todayAdjustedRevenue)} تومان</strong>
        </div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">↗</span>
          <span>درآمد ۷ روز اخیر</span>
        </div>
        <div class="kpi-value">{formatMoney(weekActualRevenue)} <small>تومان (واقعی)</small></div>
        <div class="kpi-sub">
          درآمد تعدیل‌شده: <strong>{formatMoney(weekAdjustedRevenue)} تومان</strong>
        </div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">▦</span>
          <span>درآمد ماه جاری شمسی</span>
        </div>
        <div class="kpi-value">{formatMoney(monthActualRevenue)} <small>تومان (واقعی)</small></div>
        <div class="kpi-sub">
          درآمد تعدیل‌شده: <strong>{formatMoney(monthAdjustedRevenue)} تومان</strong>
        </div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">⚙</span>
          <span>ضریب سراسری و کل دوره</span>
        </div>
        <div class="kpi-value">
          ضریب {formatNumber(activeCoefficient)}
        </div>
        <div class="kpi-sub">
          کل واقعی: {formatMoney(financialOverview.totalRevenue)} | تعدیل‌شده: {formatMoney(financialOverview.totalAdjustedRevenue)}
        </div>
      </section>
    </div>

    <!-- Estimated Net Operating Balance & Financial Comparison -->
    <section class="panel card-pad" style="margin-bottom: 18px;">
      <div class="section-heading">
        <div>
          <h2>تراز عملیاتی: درآمد واقعی، درآمد تعدیل‌شده، خریدها، هزینه‌ها و مانده عملیاتی تخمینی</h2>
          <p>
            فرمول محاسبه: مانده عملیاتی تخمینی = کل درآمد واقعی ثبت‌شده − کل خریدهای ثبت‌شده − کل هزینه‌های جاری ثبت‌شده
          </p>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom: 14px;">
        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">＋</span>
            <span>کل درآمد واقعی (A)</span>
          </div>
          <div class="kpi-value">{formatMoney(financialOverview.totalRevenue)} <small>تومان</small></div>
          <div class="kpi-sub">
            درآمد تعدیل‌شده: {formatMoney(financialOverview.totalAdjustedRevenue)} تومان
          </div>
        </div>

        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">−</span>
            <span>کل خریدهای مواد اولیه (B)</span>
          </div>
          <div class="kpi-value">{formatMoney(financialOverview.totalPurchases)} <small>تومان</small></div>
          <div class="kpi-sub">{formatNumber(financialOverview.purchasesCount)} فاکتور خرید</div>
        </div>

        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">−</span>
            <span>کل هزینه‌های جاری (C)</span>
          </div>
          <div class="kpi-value">
            {formatMoney(financialOverview.totalOperationalExpenses)} <small>تومان</small>
          </div>
          <div class="kpi-sub">{formatNumber(financialOverview.expensesCount)} ردیف هزینه عملیاتی</div>
        </div>

        <div class="panel kpi-card" style="border-color: #bfd2c5; background: #f8fbf8;">
          <div class="card-topline">
            <span class="mini-icon">＝</span>
            <span>مانده عملیاتی تخمینی (A − B − C)</span>
          </div>
          <div
            class="kpi-value"
            style="color: {financialOverview.estimatedNetOperatingBalance >= 0
              ? 'var(--green)'
              : 'var(--danger)'};"
          >
            {formatMoney(financialOverview.estimatedNetOperatingBalance)} <small>تومان</small>
          </div>
          <div class="kpi-sub">
            {financialOverview.estimatedNetOperatingBalance >= 0
              ? 'مازاد جریان نقدی ثبت‌شده'
              : 'کسری جریان نقدی ثبت‌شده'}
          </div>
        </div>
      </div>

      <!-- Visual Comparison Chart -->
      <div style="margin-top: 12px;">
        <div class="bar-row">
          <div class="bar-labels">
            <strong>درآمد واقعی (Actual Revenue)</strong>
            <span>{formatMoney(financialOverview.totalRevenue)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                4,
                Math.round((financialOverview.totalRevenue / maxFinancialBar) * 100)
              )}%; background: var(--green);"
            ></div>
          </div>
        </div>

        <div class="bar-row">
          <div class="bar-labels">
            <strong>درآمد تعدیل‌شده با ضریب {formatNumber(activeCoefficient)} (Adjusted Revenue)</strong>
            <span>{formatMoney(financialOverview.totalAdjustedRevenue)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                4,
                Math.round(
                  (financialOverview.totalAdjustedRevenue / maxFinancialBar) * 100
                )
              )}%; background: #4f8a6d;"
            ></div>
          </div>
        </div>

        <div class="bar-row">
          <div class="bar-labels">
            <strong>کل خریدهای ثبت‌شده (مواد اولیه و تدارکات)</strong>
            <span>{formatMoney(financialOverview.totalPurchases)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                4,
                Math.round((financialOverview.totalPurchases / maxFinancialBar) * 100)
              )}%; background: var(--gold);"
            ></div>
          </div>
        </div>

        <div class="bar-row">
          <div class="bar-labels">
            <strong>کل هزینه‌های عملیاتی و جاری (غیرکالایی)</strong>
            <span>{formatMoney(financialOverview.totalOperationalExpenses)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                4,
                Math.round(
                  (financialOverview.totalOperationalExpenses / maxFinancialBar) * 100
                )
              )}%; background: #8c6d46;"
            ></div>
          </div>
        </div>

        <div class="bar-row">
          <div class="bar-labels">
            <strong>مانده عملیاتی تخمینی</strong>
            <span>{formatMoney(financialOverview.estimatedNetOperatingBalance)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                4,
                Math.round(
                  (Math.abs(financialOverview.estimatedNetOperatingBalance) /
                    maxFinancialBar) *
                    100
                )
              )}%; background: {financialOverview.estimatedNetOperatingBalance >= 0
                ? 'var(--green-2)'
                : 'var(--danger)'};"
            ></div>
          </div>
        </div>
      </div>

      <div class="demo-banner-box" style="margin-top: 14px;">
        <span>
          <strong>توضیح مهم حسابداری درباره «مانده عملیاتی تخمینی»:</strong>
          این عدد بر پایه کل درآمدها، خریدها و هزینه‌های ثبت‌شده محاسبه شده است و «سود خالص حسابداری قطعی» محسوب نمی‌شود؛ زیرا بخشی از اقلام خریداری‌شده ممکن است هنوز به عنوان موجودی در انبار باقی مانده باشند و بهای تمام‌شده کالای مصرف‌شده (COGS) تنها هنگام مصرف واقعی در آشپزخانه شناسایی می‌گردد.
        </span>
      </div>
    </section>

    <!-- Dual-Series Daily & Monthly Revenue Charts (Actual + Adjusted Series) -->
    <div class="two-col-grid" style="margin-bottom: 18px;">
      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>نمودار دوگانه درآمد روزانه (واقعی و تعدیل‌شده)</h2>
            <p>مقایسه سری درآمد واقعی و سری درآمد تعدیل‌شده با ضریب {formatNumber(activeCoefficient)}</p>
          </div>
        </div>

        {#if periodDailyDualSeries.length > 0}
          {#each periodDailyDualSeries as item (item.id)}
            <div class="bar-row" style="margin-bottom: 14px;">
              <div class="bar-labels">
                <strong>
                  {getPersianWeekdayName(item.date)} {toJalaliDate(item.date)} ({toJalaliNumeric(item.date)})
                </strong>
                <span>
                  واقعی: <strong>{formatMoney(item.actualAmount)}</strong> | تعدیل‌شده: <strong>{formatMoney(item.adjustedAmount)}</strong> تومان
                </span>
              </div>
              <div class="bar-track" style="margin-bottom: 4px;" title="سری اول: درآمد واقعی">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    6,
                    Math.round((item.actualAmount / maxDailyDualRev) * 100)
                  )}%; background: var(--green);"
                ></div>
              </div>
              <div class="bar-track" title="سری دوم: درآمد تعدیل‌شده">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    6,
                    Math.round((item.adjustedAmount / maxDailyDualRev) * 100)
                  )}%; background: var(--gold);"
                ></div>
              </div>
            </div>
          {/each}
        {:else}
          <EmptyState
            title="درآمدی در این بازه ثبت نشده است"
            message="از بخش درآمد، فروش روزانه رستوران را ثبت کنید."
          />
        {/if}
      </section>

      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>نمودار دوگانه درآمد ماهانه (واقعی و تعدیل‌شده)</h2>
            <p>مقایسه ماهانه درآمد واقعی و درآمد تعدیل‌شده در تقویم جلالی</p>
          </div>
        </div>

        {#if monthlyDualSeries.length > 0}
          {#each monthlyDualSeries as item (item.ym)}
            <div class="bar-row" style="margin-bottom: 14px;">
              <div class="bar-labels">
                <strong>
                  {formatJalaliYearMonthLabel(item.ym)} ({formatNumber(item.days)} روز)
                </strong>
                <span>
                  واقعی: <strong>{formatMoney(item.actualTotal)}</strong> | تعدیل‌شده: <strong>{formatMoney(item.adjustedTotal)}</strong> تومان
                </span>
              </div>
              <div class="bar-track" style="margin-bottom: 4px;" title="سری اول: درآمد واقعی ماهانه">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    6,
                    Math.round((item.actualTotal / maxMonthlyDualRev) * 100)
                  )}%; background: var(--green);"
                ></div>
              </div>
              <div class="bar-track" title="سری دوم: درآمد تعدیل‌شده ماهانه">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    6,
                    Math.round((item.adjustedTotal / maxMonthlyDualRev) * 100)
                  )}%; background: var(--gold);"
                ></div>
              </div>
            </div>
          {/each}
        {:else}
          <EmptyState
            title="داده ماهانه‌ای وجود ندارد"
            message="پس از ثبت درآمد، جمع ماهانه در این قسمت نمایش داده می‌شود."
          />
        {/if}
      </section>
    </div>

    <!-- Employee Purchase, Timesheet & Performance Coefficient Table -->
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>جدول جامع عملکرد کارکنان (خرید، ساعت کار و ضریب عملکرد آتی)</h2>
          <p>
            شاخص «ساعت کار × ضریب عملکرد» صرفاً جهت آماده‌سازی زیرساخت ماژول مشارکت در سود آتی است و به معنای محاسبه حقوق فعلی نیست.
          </p>
        </div>
        <button type="button" class="quiet-btn" on:click={() => navigateTo('employees')}>
          ویرایش ضرایب در بخش کارکنان ←
        </button>
      </div>

      {#if employeeWorkAndCoeffTable.length > 0}
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>نام کارمند</th>
                <th>سمت</th>
                <th>تعداد خرید</th>
                <th>مجموع مبلغ خرید (تومان)</th>
                <th>روز کاری</th>
                <th>مجموع ساعت کار</th>
                <th>اضافه‌کاری</th>
                <th>ضریب عملکرد</th>
                <th>شاخص وزنی آتی (ساعت × ضریب)</th>
              </tr>
            </thead>
            <tbody>
              {#each employeeWorkAndCoeffTable as row (row.employee.id)}
                <tr>
                  <td>
                    <strong>{row.employee.name}</strong>
                    {#if !row.employee.isActive}
                      <span class="badge-low">غیرفعال</span>
                    {/if}
                  </td>
                  <td>{row.employee.role}</td>
                  <td>{formatNumber(row.purchasesCount)}</td>
                  <td><strong>{formatMoney(row.purchasesAmount)}</strong></td>
                  <td>{formatNumber(row.workingDays)} روز</td>
                  <td>{formatMinutesToPersianHours(row.workingMinutes)}</td>
                  <td>{formatMinutesToPersianHours(row.overtimeMinutes)}</td>
                  <td><strong>{formatNumber(row.employee.performanceCoefficient)}</strong></td>
                  <td>{formatNumber(row.weightedUnits)} واحد وزنی</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}
        <EmptyState
          title="کارمندی ثبت نشده است"
          message="از بخش کارکنان پرسنل رستوران را تعریف کنید."
        />
      {/if}
    </section>
  {/if}
</section>
