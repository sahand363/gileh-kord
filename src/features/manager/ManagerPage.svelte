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
    updateGlobalRevenueCoefficient,
    deleteRevenueDayRecord
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
    calculateFinancialOverview,
    calculateRevenueTotal,
    compareEmployeePurchaseTotals,
    filterRevenueRecords,
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
    { id: 'overview', label: 'درآمد، تراز مالی و حقوق', icon: '⌑' },
    { id: 'employees', label: 'کارکنان', icon: '♟' },
    { id: 'suppliers', label: 'تأمین‌کنندگان', icon: '◈' },
    { id: 'inventory', label: 'انبار و موجودی', icon: '◫' },
    { id: 'reports', label: 'گزارش‌های خرید', icon: '↗' },
    { id: 'backup', label: 'پشتیبان‌گیری', icon: '⇧' }
  ];

  const SALARY_COEFF_PRESETS = [0.5, 0.6, 0.7, 0.8, 1.0];

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

  // Editable Salary Coefficient (Default 0.7, changeable to any number)
  let salaryCoeffInput = '0.7';
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

  $: salaryCoefficient = $appSettings.globalRevenueCoefficient ?? 0.7;

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      usernameInput = $activeManagerUsername;
    }
    salaryCoeffInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
  });

  // 100% Real Income KPIs (Today, 7-Day, Current Jalali Month)
  $: todayRecords = filterRevenueRecords($revenues, todayISO, todayISO, onlyReal);
  $: todayRealRevenue = calculateRevenueTotal(todayRecords);

  $: weekRecords = filterRevenueRecords($revenues, sevenDaysAgoISO, todayISO, onlyReal);
  $: weekRealRevenue = calculateRevenueTotal(weekRecords);

  $: monthRecords = $revenues.filter(
    (r) =>
      (!onlyReal || !r.isDemo) &&
      getJalaliYearMonthKey(r.date) === currentJalaliMonthKey
  );
  $: monthRealRevenue = calculateRevenueTotal(monthRecords);

  $: financialOverview = calculateFinancialOverview({
    revenues: $revenues,
    purchases: $purchases,
    expenses: $expenses,
    coefficient: salaryCoefficient,
    dateFrom,
    dateTo,
    onlyReal
  });

  // Calculated Salary Pool based on the editable 0.7 (or custom) salary coefficient
  $: calculatedSalaryPool = Math.round(
    financialOverview.totalRevenue * salaryCoefficient
  );

  // Column Chart 1: Real Financial Overview Columns
  $: financialBalanceColumns = [
    {
      id: 'fin_real_rev',
      label: 'درآمد واقعی',
      subLabel: 'کل فروش',
      value: financialOverview.totalRevenue,
      tone: 'primary'
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

  // Filtered daily revenue list for Manager inspection
  $: filteredDailyRevenues = filterRevenueRecords(
    $revenues,
    dateFrom,
    dateTo,
    onlyReal
  );

  // Column Chart 2: 100% Real Daily Revenue Column Chart (No 0.7 scaling on chart)
  $: realDailyRevenueColumns = filteredDailyRevenues
    .slice(0, 12)
    .reverse()
    .map(
      (r): ColumnChartItem => ({
        id: r.id,
        label: getPersianWeekdayName(r.date),
        subLabel: toJalaliNumeric(r.date).slice(5),
        value: getEffectiveDayRevenue(r),
        tone: 'primary'
      })
    );

  // Column Chart 3: 100% Real Monthly Revenue Column Chart (No 0.7 scaling on chart)
  $: realMonthlyRevenueColumns = (() => {
    const map = new Map<string, { ym: string; total: number; days: number }>();
    for (const r of filteredDailyRevenues) {
      const ym = getJalaliYearMonthKey(r.date);
      if (!ym) continue;
      const prev = map.get(ym) || { ym, total: 0, days: 0 };
      prev.total += getEffectiveDayRevenue(r);
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
          value: m.total,
          tone: 'gold'
        })
      );
  })();

  // Employee Purchase, Timesheet & Salary Coefficient Calculations
  $: employeePurchaseComparisons = compareEmployeePurchaseTotals(
    $purchases.filter((p) => !onlyReal || !p.isDemo),
    $employees,
    dateFrom,
    dateTo
  );

  $: employeeSalaryRows = (() => {
    const rawRows = $employees.map((emp) => {
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
      const salaryAdjustedHours = Number(
        (
          tsSummary.totalWorkingHoursDecimal *
          emp.performanceCoefficient *
          salaryCoefficient
        ).toFixed(2)
      );

      return {
        employee: emp,
        purchasesCount: purchSummary?.count || 0,
        purchasesAmount: purchSummary?.totalAmount || 0,
        workingDays: tsSummary.workingDaysCount,
        workingMinutes: tsSummary.totalWorkingMinutes,
        workingHoursDecimal: tsSummary.totalWorkingHoursDecimal,
        overtimeMinutes: tsSummary.totalOvertimeMinutes,
        salaryAdjustedHours
      };
    });

    const totalWeightedHours = rawRows.reduce(
      (s, r) => s + r.salaryAdjustedHours,
      0
    );

    return rawRows.map((row) => ({
      ...row,
      estimatedSalaryShare:
        totalWeightedHours > 0
          ? Math.round(
              (row.salaryAdjustedHours / totalWeightedHours) * calculatedSalaryPool
            )
          : 0
    }));
  })();

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

  async function applySalaryCoefficient(val: number) {
    coeffError = '';
    if (isNaN(val) || val <= 0 || val > 100) {
      coeffError = 'لطفاً عددی بزرگ‌تر از صفر وارد کنید.';
      return;
    }
    try {
      const saved = await updateGlobalRevenueCoefficient(val);
      salaryCoeffInput = String(saved.globalRevenueCoefficient);
      showToast(
        `ضریب محاسبه حقوق به ${formatNumber(saved.globalRevenueCoefficient)} تغییر یافت.`
      );
    } catch (err) {
      coeffError = err instanceof Error ? err.message : 'خطا در ذخیره ضریب حقوق.';
    }
  }

  async function handleSaveSalaryCoefficient() {
    const parsed = parseNumericInput(salaryCoeffInput);
    await applySalaryCoefficient(parsed);
  }

  async function handleDeleteRevenueRecord(id: string, date: string) {
    const confirmed = window.confirm(
      `آیا از حذف درآمد ثبت‌شده برای تاریخ ${toJalaliDate(date)} مطمئن هستید؟`
    );
    if (!confirmed) return;
    await deleteRevenueDayRecord(id);
    showToast('رکورد درآمد حذف شد.');
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
    salaryCoeffInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
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
    salaryCoeffInput = String($appSettings.globalRevenueCoefficient ?? 0.7);
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
        مشاهده درآمدهای واقعی، نمودارهای فروش، تنظیم ضریب ۰.۷ حقوق، کارکنان، انبار، تأمین‌کنندگان، گزارش‌ها و پشتیبان‌گیری فقط با رمز مدیر امکان‌پذیر است.
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
        برای مشاهده نمودارهای درآمد واقعی، تنظیم ضریب حقوق، مدیریت کارکنان، انبار، تأمین‌کنندگان و پشتیبان‌گیری وارد شوید.
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
    <!-- Unlocked Manager Top Bar -->
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

    <!-- Segmented Sub-Navigation for All Manager-Protected Modules -->
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
      <!-- Date Filter Bar -->
      <section class="panel card-pad" style="margin-bottom: 16px;">
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

      <!-- 100% Real Income KPI Cards -->
      <div class="kpi-grid">
        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">₿</span>
            <span>درآمد واقعی امروز</span>
          </div>
          <div class="kpi-value">{formatMoney(todayRealRevenue)} <small>تومان</small></div>
          <div class="kpi-sub">{toJalaliDate(todayISO)}</div>
        </section>

        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">↗</span>
            <span>درآمد واقعی ۷ روز اخیر</span>
          </div>
          <div class="kpi-value">{formatMoney(weekRealRevenue)} <small>تومان</small></div>
          <div class="kpi-sub">هفته جاری</div>
        </section>

        <section class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">▦</span>
            <span>درآمد واقعی ماه جاری</span>
          </div>
          <div class="kpi-value">{formatMoney(monthRealRevenue)} <small>تومان</small></div>
          <div class="kpi-sub">{formatJalaliYearMonthLabel(currentJalaliMonthKey)}</div>
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

      <!-- 100% Real Daily & Monthly Revenue Column Charts -->
      <div class="two-col-grid" style="margin-bottom: 16px;">
        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی درآمد واقعی روزانه</h2>
              <p>مبالغ واقعی فروش روزانه به تاریخ شمسی (بدون اعمال ضریب)</p>
            </div>
          </div>

          {#if realDailyRevenueColumns.length > 0}
            <ColumnChart items={realDailyRevenueColumns} height={200} />
          {:else}
            <EmptyState title="درآمدی ثبت نشده است" message="از تب درآمد، فروش روزانه را ثبت کنید." />
          {/if}
        </section>

        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی درآمد واقعی ماهانه</h2>
              <p>مجموع درآمد واقعی به تفکیک ماه‌های شمسی</p>
            </div>
          </div>

          {#if realMonthlyRevenueColumns.length > 0}
            <ColumnChart items={realMonthlyRevenueColumns} height={200} />
          {:else}
            <EmptyState title="داده ماهانه‌ای وجود ندارد" message="پس از ثبت درآمد، نمودار ماهانه تکمیل می‌شود." />
          {/if}
        </section>
      </div>

      <!-- Financial Balance Column Chart -->
      <section class="panel card-pad" style="margin-bottom: 16px;">
        <div class="section-heading">
          <div>
            <h2>نمودار ستونی تراز مالی (درآمد واقعی در برابر خریدها و هزینه‌ها)</h2>
            <p>مقایسه کل درآمد واقعی، کل خریدهای مواد اولیه، هزینه‌های جاری و مانده عملیاتی تخمینی</p>
          </div>
        </div>
        <ColumnChart items={financialBalanceColumns} height={190} />
      </section>

      <!-- Editable 0.7 Salary Coefficient & Employee Salary Table -->
      <section class="panel card-pad coeff-editor-card" style="margin-bottom: 16px;">
        <div class="two-col-grid" style="align-items: center; margin-bottom: 14px;">
          <div>
            <span class="eyebrow">تنظیم ضریب محاسبه حقوق کارکنان (پیش‌فرض ۰.۷)</span>
            <h2 style="font-size: 17px; margin: 0 0 5px;">
              ضریب فعلی حقوق: <strong style="color: var(--green); font-size: 20px;">{formatNumber(salaryCoefficient)}</strong>
            </h2>
            <p style="margin: 0; font-size: 11px; color: var(--muted); line-height: 1.7;">
              این ضریب مخصوص فرمول حقوق و سهم کارکنان است و می‌توانید آن را از <strong>۰.۷</strong> به هر عدد دلخواه تغییر دهید.
            </p>
          </div>

          <div>
            <form
              on:submit|preventDefault={handleSaveSalaryCoefficient}
              class="coeff-form-row"
              novalidate
            >
              <input
                id="globalRevCoeff"
                inputmode="decimal"
                dir="ltr"
                bind:value={salaryCoeffInput}
                placeholder="0.7"
                class="coeff-input"
                aria-label="ضریب محاسبه حقوق"
              />
              <button type="submit" class="primary-btn" style="width: auto; min-height: 44px; gap: 10px;">
                <span>اعمال ضریب حقوق</span>
                <span>✓</span>
              </button>
            </form>

            <div class="coeff-presets">
              <span>انتخاب سریع:</span>
              {#each SALARY_COEFF_PRESETS as preset}
                <button
                  type="button"
                  class="preset-chip"
                  class:active={salaryCoefficient === preset}
                  on:click={() => {
                    salaryCoeffInput = String(preset);
                    applySalaryCoefficient(preset);
                  }}
                >
                  {formatNumber(preset)}
                </button>
              {/each}
            </div>
          </div>
        </div>

        {#if coeffError}
          <div class="form-error" role="alert" style="margin-top: 8px; margin-bottom: 10px;">
            {coeffError}
          </div>
        {/if}

        <div class="stat-divider" style="margin: 14px 0;"></div>

        <div class="section-heading">
          <div>
            <h2>جدول عملکرد، ساعت کار و محاسبه ضریب حقوق کارکنان (ضریب: {formatNumber(salaryCoefficient)})</h2>
            <p>محاسبه ساعت کار وزنی و سهم حقوق هر کارمند بر اساس ضریب {formatNumber(salaryCoefficient)}</p>
          </div>
          <button
            type="button"
            class="secondary-btn"
            on:click={() => activeManagerTab.set('employees')}
          >
            مدیریت کارکنان ←
          </button>
        </div>

        {#if employeeSalaryRows.length > 0}
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>نام کارمند</th>
                  <th>سمت</th>
                  <th>تعداد خرید</th>
                  <th>مجموع خرید (تومان)</th>
                  <th>ساعت کار</th>
                  <th>ضریب فردی</th>
                  <th>شاخص حقوق (با ضریب {formatNumber(salaryCoefficient)})</th>
                  <th>سهم تخمینی از ضریب (تومان)</th>
                </tr>
              </thead>
              <tbody>
                {#each employeeSalaryRows as row (row.employee.id)}
                  <tr>
                    <td>
                      <strong>{row.employee.name}</strong>
                      {#if !row.employee.isActive}
                        <span class="badge-low">غیرفعال</span>
                      {/if}
                    </td>
                    <td>{row.employee.role}</td>
                    <td>{formatNumber(row.purchasesCount)}</td>
                    <td>{formatMoney(row.purchasesAmount)}</td>
                    <td>{formatMinutesToPersianHours(row.workingMinutes)}</td>
                    <td>{formatNumber(row.employee.performanceCoefficient)}</td>
                    <td><strong>{formatNumber(row.salaryAdjustedHours)} واحد</strong></td>
                    <td><strong>{formatMoney(row.estimatedSalaryShare)}</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <EmptyState title="کارمندی ثبت نشده است" message="از تب کارکنان پرسنل را اضافه کنید." />
        {/if}
      </section>

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

      <!-- Full Recorded Revenue History List (Visible Only to Manager) -->
      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>فهرست درآمدهای واقعی ثبت‌شده ({formatNumber(filteredDailyRevenues.length)} روز)</h2>
            <p>این فهرست فقط در پنل مدیریت قابل مشاهده است</p>
          </div>
        </div>

        <div class="purchase-list">
          {#if filteredDailyRevenues.length > 0}
            {#each filteredDailyRevenues as rev (rev.id)}
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
                        ? 'ثبت کلی'
                        : `ریز فروش (${formatNumber(rev.entries.length)} ردیف)`}
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
                    on:click={() => handleDeleteRevenueRecord(rev.id, rev.date)}
                  >
                    حذف
                  </button>
                </div>
              </article>
            {/each}
          {:else}
            <EmptyState title="درآمدی در این بازه ثبت نشده است" message="رکوردهای ثبت‌شده از تب درآمد در این فهرست نمایش داده می‌شوند." />
          {/if}
        </div>
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
