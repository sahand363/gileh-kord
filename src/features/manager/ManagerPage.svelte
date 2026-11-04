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
  import {
    activeManagerTab,
    type ManagerSubTab
  } from '../../stores/navigationStore';
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
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  // Embedded Manager-Only Sub-Modules
  import EmployeesPage from '../employees/EmployeesPage.svelte';
  import SuppliersPage from '../suppliers/SuppliersPage.svelte';
  import InventoryPage from '../inventory/InventoryPage.svelte';
  import ReportsPage from '../reports/ReportsPage.svelte';
  import BackupPage from '../backup/BackupPage.svelte';

  const MANAGER_TABS: Array<{ id: ManagerSubTab; label: string; icon: string }> = [
    { id: 'overview', label: 'تراز مالی و ضریب', icon: '⌑' },
    { id: 'employees', label: 'کارکنان و حقوق', icon: '♟' },
    { id: 'suppliers', label: 'تأمین‌کنندگان', icon: '◈' },
    { id: 'inventory', label: 'انبار و موجودی', icon: '◫' },
    { id: 'reports', label: 'گزارش‌های خرید', icon: '↗' },
    { id: 'backup', label: 'پشتیبان‌گیری', icon: '⇧' }
  ];

  const COEFF_PRESETS = [0.5, 0.6, 0.7, 0.8, 1.0];

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

  // Editable Coefficient (0.7 or any custom number)
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

  $: todayRecords = filterRevenueRecords($revenues, todayISO, todayISO, onlyReal);
  $: todayActualRevenue = calculateRevenueTotal(todayRecords);
  $: todayAdjustedRevenue = calculateAdjustedRevenueTotal(todayRecords, activeCoefficient);

  $: weekRecords = filterRevenueRecords($revenues, sevenDaysAgoISO, todayISO, onlyReal);
  $: weekActualRevenue = calculateRevenueTotal(weekRecords);
  $: weekAdjustedRevenue = calculateAdjustedRevenueTotal(weekRecords, activeCoefficient);

  $: monthRecords = $revenues.filter(
    (r) =>
      (!onlyReal || !r.isDemo) &&
      getJalaliYearMonthKey(r.date) === currentJalaliMonthKey
  );
  $: monthActualRevenue = calculateRevenueTotal(monthRecords);
  $: monthAdjustedRevenue = calculateAdjustedRevenueTotal(monthRecords, activeCoefficient);

  $: financialOverview = calculateFinancialOverview({
    revenues: $revenues,
    purchases: $purchases,
    expenses: $expenses,
    coefficient: activeCoefficient,
    dateFrom,
    dateTo,
    onlyReal
  });

  // Column Chart 1: Financial Overview Columns
  $: financialBalanceColumns = [
    {
      id: 'fin_actual_rev',
      label: 'درآمد واقعی',
      subLabel: '۱۰۰٪ فروش',
      value: financialOverview.totalRevenue,
      tone: 'primary'
    },
    {
      id: 'fin_adj_rev',
      label: `با ضریب ${formatNumber(activeCoefficient)}`,
      subLabel: 'درآمد/سهم',
      value: financialOverview.totalAdjustedRevenue,
      tone: 'gold'
    },
    {
      id: 'fin_purchases',
      label: 'کل خریدها',
      subLabel: 'مواد اولیه',
      value: financialOverview.totalPurchases,
      tone: 'gold'
    },
    {
      id: 'fin_expenses',
      label: 'هزینه جاری',
      subLabel: 'قبوض/حمل',
      value: financialOverview.totalOperationalExpenses,
      tone: 'danger'
    },
    {
      id: 'fin_net',
      label: 'مانده عملیاتی',
      subLabel: 'تخمینی',
      value: Math.max(0, financialOverview.estimatedNetOperatingBalance),
      tone: financialOverview.estimatedNetOperatingBalance >= 0 ? 'primary' : 'danger'
    }
  ] as ColumnChartItem[];

  // Column Chart 2: Dual-Series Daily Revenue (Actual vs. Adjusted)
  $: dailyDualColumnItems = filterRevenueRecords($revenues, dateFrom, dateTo, onlyReal)
    .slice(0, 10)
    .reverse()
    .map(
      (r): ColumnChartItem => ({
        id: r.id,
        label: getPersianWeekdayName(r.date),
        subLabel: toJalaliNumeric(r.date).slice(5),
        value: getEffectiveDayRevenue(r),
        secondaryValue: getAdjustedDayRevenue(r, activeCoefficient)
      })
    );

  // Column Chart 3: Dual-Series Monthly Revenue (Actual vs. Adjusted)
  $: monthlyDualColumnItems = (() => {
    const map = new Map<
      string,
      { ym: string; actualTotal: number; adjustedTotal: number; days: number }
    >();
    const list = filterRevenueRecords($revenues, dateFrom, dateTo, onlyReal);
    for (const r of list) {
      const ym = getJalaliYearMonthKey(r.date);
      if (!ym) continue;
      const prev = map.get(ym) || { ym, actualTotal: 0, adjustedTotal: 0, days: 0 };
      prev.actualTotal += getEffectiveDayRevenue(r);
      prev.adjustedTotal += getAdjustedDayRevenue(r, activeCoefficient);
      prev.days += 1;
      map.set(ym, prev);
    }
    return Array.from(map.values())
      .sort((a, b) => a.ym.localeCompare(b.ym))
      .map(
        (m): ColumnChartItem => ({
          id: m.ym,
          label: formatJalaliYearMonthLabel(m.ym),
          subLabel: `${m.days} روز`,
          value: m.actualTotal,
          secondaryValue: m.adjustedTotal
        })
      );
  })();

  // Employee Purchase, Timesheet & Salary/Share Coefficient Table
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
    const salaryCoeffUnits = Number(
      (weightedUnits * activeCoefficient).toFixed(2)
    );

    return {
      employee: emp,
      purchasesCount: purchSummary?.count || 0,
      purchasesAmount: purchSummary?.totalAmount || 0,
      workingDays: tsSummary.workingDaysCount,
      workingMinutes: tsSummary.totalWorkingMinutes,
      workingHoursDecimal: tsSummary.totalWorkingHoursDecimal,
      overtimeMinutes: tsSummary.totalOvertimeMinutes,
      weightedUnits,
      salaryCoeffUnits
    };
  });

  $: employeeSpendColumns = employeePurchaseComparisons
    .filter((c) => c.totalAmount > 0)
    .map(
      (c): ColumnChartItem => ({
        id: c.employeeId,
        label: c.employeeName,
        subLabel: `${c.count} خرید`,
        value: c.totalAmount,
        tone: 'primary'
      })
    );

  async function applyCoefficientValue(val: number) {
    coeffError = '';
    if (isNaN(val) || val <= 0 || val > 100) {
      coeffError = 'لطفاً عددی بزرگ‌تر از صفر وارد کنید.';
      return;
    }
    try {
      const saved = await updateGlobalRevenueCoefficient(val);
      coefficientInput = String(saved.globalRevenueCoefficient);
      showToast(
        `ضریب به ${formatNumber(saved.globalRevenueCoefficient)} تغییر یافت و در کل برنامه اعمال شد.`
      );
    } catch (err) {
      coeffError = err instanceof Error ? err.message : 'خطا در ذخیره ضریب.';
    }
  }

  async function handleSaveGlobalCoefficient() {
    const parsed = parseNumericInput(coefficientInput);
    await applyCoefficientValue(parsed);
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
    showToast('رمز عبور مدیر تغییر یافت.');
  }

  function handleLockPanel() {
    managerAuthService.lock();
    showToast('پنل مدیریت قفل شد.');
  }
</script>

<section class="page active" aria-labelledby="managerTitle">
  {#if !$isManagerConfigured}
    <div class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h1 id="managerTitle" style="font-size: 19px; margin: 0;">راه‌اندازی رمز پنل مدیریت</h1>
      <p>
        بخش‌های مدیریتی (تنظیم ضریب ۰.۷، کارکنان، انبار، تأمین‌کنندگان، گزارش‌ها و پشتیبان‌گیری) فقط با نام کاربری و رمز عبور شما قابل مشاهده هستند.
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
            placeholder="رمز عبور دلخواه"
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

        <button type="submit" class="primary-btn">
          <span>ایجاد حساب و ورود به پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else if !$isManagerUnlocked}
    <div id="settingsLogin" class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h1 id="managerTitle" style="font-size: 19px; margin: 0;">ورود به پنل مدیریت</h1>
      <p>
        برای دسترسی به تنظیم ضریب درآمد و حقوق، کارکنان، انبار، تأمین‌کنندگان، گزارش‌ها و پشتیبان‌گیری وارد شوید.
      </p>

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

        <button type="submit" class="primary-btn">
          <span>ورود به پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else}
    <!-- Unlocked Manager Header & Mobile-First Segmented Navigation -->
    <div class="manager-top-bar panel">
      <div class="manager-top-info">
        <span class="badge-real">مدیر: {$activeManagerUsername}</span>
        <strong>پنل اختصاصی مدیریت گیله‌کُرد</strong>
      </div>
      <div class="setting-actions">
        <button
          type="button"
          class="quiet-btn"
          on:click={() => (showPasswordChange = !showPasswordChange)}
        >
          ⚙ تغییر رمز
        </button>
        <button
          id="adminLogout"
          type="button"
          class="secondary-btn"
          on:click={handleLockPanel}
        >
          ⌑ قفل پنل
        </button>
      </div>
    </div>

    {#if showPasswordChange}
      <div class="panel card-pad" style="margin-bottom: 16px; max-width: 480px;">
        <div class="section-heading">
          <h2>تغییر رمز عبور مدیر</h2>
          <button type="button" class="quiet-btn" on:click={() => (showPasswordChange = false)}>
            بستن
          </button>
        </div>
        <form on:submit|preventDefault={handleChangePassword} novalidate>
          <div class="field">
            <label for="mgrCurrentPass">رمز فعلی</label>
            <input id="mgrCurrentPass" type="password" bind:value={currentPassInput} required />
          </div>
          <div class="field">
            <label for="mgrNewPass">رمز جدید (حداقل ۴ کاراکتر)</label>
            <input id="mgrNewPass" type="password" bind:value={newPassInput} required />
          </div>
          {#if changePassError}
            <div class="form-error" role="alert">{changePassError}</div>
          {/if}
          <button type="submit" class="primary-btn">
            <span>ذخیره رمز جدید</span>
            <span class="btn-arrow">←</span>
          </button>
        </form>
      </div>
    {/if}

    <!-- Segmented Sub-Navigation for All Manager-Protected Sections -->
    <nav class="manager-subnav" aria-label="بخش‌های پنل مدیریت">
      {#each MANAGER_TABS as tab (tab.id)}
        <button
          type="button"
          class="manager-tab-pill"
          class:active={$activeManagerTab === tab.id}
          on:click={() => activeManagerTab.set(tab.id)}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>

    {#if $activeManagerTab === 'overview'}
      <!-- Editable 0.7 Salary / Revenue Coefficient Card -->
      <section class="panel card-pad coeff-editor-card" style="margin-bottom: 16px;">
        <div class="two-col-grid" style="align-items: center;">
          <div>
            <span class="eyebrow">تنظیم ضریب محاسبه درآمد و حقوق (پیش‌فرض ۰.۷)</span>
            <h2 style="font-size: 17px; margin: 0 0 5px;">
              ضریب فعلی: <strong style="color: var(--green); font-size: 20px;">{formatNumber(activeCoefficient)}</strong>
            </h2>
            <p style="margin: 0; font-size: 11px; color: var(--muted); line-height: 1.7;">
              می‌توانید عدد <strong>۰.۷</strong> را به هر عدد دلخواه (مثلاً ۰.۵، ۰.۶۵، ۰.۸، ۱.۲ و غیره) تغییر دهید. نمودار عمومی «درآمد» و محاسبه سهم/حقوق کارکنان بلافاصله با این عدد جدید محاسبه می‌شوند.
            </p>
          </div>

          <div>
            <form
              on:submit|preventDefault={handleSaveGlobalCoefficient}
              class="coeff-form-row"
              novalidate
            >
              <input
                id="globalRevCoeff"
                inputmode="decimal"
                dir="ltr"
                bind:value={coefficientInput}
                placeholder="0.7"
                class="coeff-input"
                aria-label="ضریب درآمد و حقوق"
              />
              <button type="submit" class="primary-btn" style="width: auto; min-height: 44px; gap: 10px;">
                <span>اعمال ضریب جدید</span>
                <span>✓</span>
              </button>
            </form>

            <div class="coeff-presets">
              <span>انتخاب سریع:</span>
              {#each COEFF_PRESETS as preset}
                <button
                  type="button"
                  class="preset-chip"
                  class:active={activeCoefficient === preset}
                  on:click={() => {
                    coefficientInput = String(preset);
                    applyCoefficientValue(preset);
                  }}
                >
                  {formatNumber(preset)}
                </button>
              {/each}
            </div>
          </div>
        </div>

        {#if coeffError}
          <div class="form-error" role="alert" style="margin-top: 10px; margin-bottom: 0;">
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
            {onlyReal ? '✓ فقط داده‌های واقعی' : 'همه (شامل نمونه)'}
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
              پاک کردن فیلتر
            </button>
          {/if}
        </div>
      </section>

      <!-- KPI Cards: Actual vs. Adjusted Revenue -->
      <div class="kpi-grid">
        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">₿</span>
            <span>درآمد امروز</span>
          </div>
          <div class="kpi-value">{formatMoney(todayActualRevenue)} <small>واقعی</small></div>
          <div class="kpi-sub">
            با ضریب {formatNumber(activeCoefficient)}: <strong>{formatMoney(todayAdjustedRevenue)} تومان</strong>
          </div>
        </section>

        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">↗</span>
            <span>درآمد ۷ روز اخیر</span>
          </div>
          <div class="kpi-value">{formatMoney(weekActualRevenue)} <small>واقعی</small></div>
          <div class="kpi-sub">
            با ضریب {formatNumber(activeCoefficient)}: <strong>{formatMoney(weekAdjustedRevenue)} تومان</strong>
          </div>
        </section>

        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">▦</span>
            <span>درآمد ماه جاری</span>
          </div>
          <div class="kpi-value">{formatMoney(monthActualRevenue)} <small>واقعی</small></div>
          <div class="kpi-sub">
            با ضریب {formatNumber(activeCoefficient)}: <strong>{formatMoney(monthAdjustedRevenue)} تومان</strong>
          </div>
        </section>

        <section class="panel kpi-card" style="border-color: #bfd2c5; background: #f8fbf8;">
          <div class="card-topline">
            <span class="mini-icon">＝</span>
            <span>مانده عملیاتی تخمینی</span>
          </div>
          <div
            class="kpi-value"
            style="color: {financialOverview.estimatedNetOperatingBalance >= 0
              ? 'var(--green)'
              : 'var(--danger)'};"
          >
            {formatMoney(financialOverview.estimatedNetOperatingBalance)} <small>تومان</small>
          </div>
          <div class="kpi-sub">درآمد واقعی − خریدها − هزینه‌ها</div>
        </section>
      </div>

      <!-- Vertical Column Chart: Financial Balance Comparison -->
      <section class="panel card-pad" style="margin-bottom: 16px;">
        <div class="section-heading">
          <div>
            <h2>نمودار ستونی تراز مالی و مانده عملیاتی تخمینی</h2>
            <p>مقایسه ستونی درآمد واقعی، درآمد با ضریب {formatNumber(activeCoefficient)}، خریدها، هزینه‌ها و مانده عملیاتی</p>
          </div>
        </div>
        <ColumnChart items={financialBalanceColumns} height={195} />
      </section>

      <!-- Dual-Series Vertical Column Charts: Daily & Monthly Revenue -->
      <div class="two-col-grid" style="margin-bottom: 16px;">
        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی دوگانه درآمد روزانه</h2>
              <p>مقایسه ستون درآمد واقعی و ستون تعدیل‌شده با ضریب {formatNumber(activeCoefficient)}</p>
            </div>
          </div>

          {#if dailyDualColumnItems.length > 0}
            <ColumnChart
              items={dailyDualColumnItems}
              height={200}
              showSecondary={true}
              primaryLegend="درآمد واقعی"
              secondaryLegend="با ضریب {formatNumber(activeCoefficient)}"
            />
          {:else}
            <EmptyState title="درآمدی ثبت نشده است" message="از تب درآمد فروش روزانه را ثبت کنید." />
          {/if}
        </section>

        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی دوگانه درآمد ماهانه</h2>
              <p>مقایسه ماهانه درآمد واقعی و تعدیل‌شده (شمسی)</p>
            </div>
          </div>

          {#if monthlyDualColumnItems.length > 0}
            <ColumnChart
              items={monthlyDualColumnItems}
              height={200}
              showSecondary={true}
              primaryLegend="درآمد واقعی ماه"
              secondaryLegend="با ضریب {formatNumber(activeCoefficient)}"
            />
          {:else}
            <EmptyState title="داده ماهانه‌ای وجود ندارد" message="پس از ثبت درآمد، نمودار ماهانه تکمیل می‌شود." />
          {/if}
        </section>
      </div>

      {#if employeeSpendColumns.length > 0}
        <section class="panel card-pad" style="margin-bottom: 16px;">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی مقایسه خرید کارکنان</h2>
              <p>حجم ریالی خرید انجام‌شده توسط هر یک از کارکنان</p>
            </div>
          </div>
          <ColumnChart items={employeeSpendColumns} height={180} />
        </section>
      {/if}

      <!-- Employee Performance & Salary Coefficient Table -->
      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>جدول عملکرد، ساعت کار و ضریب حقوق کارکنان (ضریب فعال: {formatNumber(activeCoefficient)})</h2>
            <p>بررسی یکپارچه خریدها، ساعات کاری و شاخص ضریب حقوق و عملکرد هر کارمند</p>
          </div>
          <button
            type="button"
            class="secondary-btn"
            on:click={() => activeManagerTab.set('employees')}
          >
            مدیریت کامل کارکنان ←
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
                  <th>مجموع خرید (تومان)</th>
                  <th>مجموع ساعت کار</th>
                  <th>ضریب فردی</th>
                  <th>شاخص با ضریب {formatNumber(activeCoefficient)}</th>
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
                    <td>{formatMinutesToPersianHours(row.workingMinutes)}</td>
                    <td>{formatNumber(row.employee.performanceCoefficient)}</td>
                    <td><strong>{formatNumber(row.salaryCoeffUnits)} واحد</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <EmptyState title="کارمندی ثبت نشده است" message="از تب کارکنان در بالای همین پنل، پرسنل را اضافه کنید." />
        {/if}
      </section>
    {:else if $activeManagerTab === 'employees'}
      <EmployeesPage />
    {:else if $activeManagerTab === 'suppliers'}
      <SuppliersPage />
    {:else if $activeManagerTab === 'inventory'}
      <InventoryPage />
    {:else if $activeManagerTab === 'reports'}
      <ReportsPage />
    {:else if $activeManagerTab === 'backup'}
      <BackupPage />
    {/if}
  {/if}
</section>
