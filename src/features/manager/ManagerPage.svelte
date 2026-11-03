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
    timesheets
  } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import { showToast } from '../../stores/toastStore';
  import {
    formatMoney,
    formatNumber,
    getTodayISODate,
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

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      usernameInput = $activeManagerUsername;
    }
  });

  // Revenue KPIs (Today, This Week / 7 Days, This Jalali Month)
  $: todayRevenue = calculateRevenueTotal(
    filterRevenueRecords($revenues, todayISO, todayISO, onlyReal)
  );

  $: weekRevenue = calculateRevenueTotal(
    filterRevenueRecords($revenues, sevenDaysAgoISO, todayISO, onlyReal)
  );

  $: monthRevenue = calculateRevenueTotal(
    $revenues.filter(
      (r) =>
        (!onlyReal || !r.isDemo) &&
        getJalaliYearMonthKey(r.date) === currentJalaliMonthKey
    )
  );

  // Selected Period Financial Overview (Revenue - Purchases - Operational Expenses)
  $: financialOverview = calculateFinancialOverview({
    revenues: $revenues,
    purchases: $purchases,
    expenses: $expenses,
    dateFrom,
    dateTo,
    onlyReal
  });

  $: maxFinancialBar = Math.max(
    1,
    financialOverview.totalRevenue,
    financialOverview.totalPurchases,
    financialOverview.totalOperationalExpenses,
    Math.abs(financialOverview.estimatedNetOperatingBalance)
  );

  // Filtered daily revenues for daily chart
  $: periodRevenueList = filterRevenueRecords(
    $revenues,
    dateFrom,
    dateTo,
    onlyReal
  ).slice(0, 14);

  $: maxDailyRev =
    periodRevenueList.length > 0
      ? Math.max(1, ...periodRevenueList.map((r) => getEffectiveDayRevenue(r)))
      : 1;

  // Monthly revenue aggregation
  $: monthlyRevenueList = (() => {
    const map = new Map<string, { ym: string; total: number; days: number }>();
    const list = filterRevenueRecords($revenues, dateFrom, dateTo, onlyReal);
    for (const r of list) {
      const ym = getJalaliYearMonthKey(r.date);
      if (!ym) continue;
      const prev = map.get(ym) || { ym, total: 0, days: 0 };
      prev.total += getEffectiveDayRevenue(r);
      prev.days += 1;
      map.set(ym, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.ym.localeCompare(a.ym));
  })();

  $: maxMonthlyRev =
    monthlyRevenueList.length > 0
      ? Math.max(1, ...monthlyRevenueList.map((m) => m.total))
      : 1;

  // Employee Purchase & Timesheet + Performance Coefficient Overview
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
      <p class="eyebrow">بخش خصوصی مدیریت مالی، سود عملیاتی و عملکرد پرسنل</p>
      <h1 id="managerTitle">پنل مدیریت</h1>
      <p class="subheading">
        دسترسی به گزارش‌های حساس درآمد، مانده عملیاتی تخمینی، مقایسه خریدها و ضریب عملکرد کارکنان.
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
    <!-- Initial Manager Account Setup (No hardcoded password) -->
    <div class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h2>راه‌اندازی اولیه دسترسی مدیر</h2>
      <p>
        برای محافظت از اطلاعات مالی و گزارش‌های درآمد در برابر دید عمومی در محیط رستوران، یک نام کاربری و رمز عبور محلی تعیین کنید.
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
          توجه امنیتی شفاف: این قفل یک «محافظ رابط کاربری محلی» در مرورگر است تا ارقام مالی در صفحه عمومی ثبت خرید دیده نشوند. احراز هویت رمزنگاری‌شده سروری نیازمند بک‌اند Go در فاز بعدی است.
        </p>

        <button type="submit" class="primary-btn">
          <span>ایجاد حساب و ورود به پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else if !$isManagerUnlocked}
    <!-- Manager Login Gate -->
    <div id="settingsLogin" class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h2>ورود به پنل مدیریت</h2>
      <p>برای مشاهده گزارش‌های درآمد، مانده عملیاتی و تحلیل عملکرد کارکنان وارد شوید.</p>

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
          این قفل محلی جهت جداسازی صفحه روزمره ثبت خرید از گزارش‌های مدیریتی است. امنیت کامل سروری در فاز بک‌اند Go پیاده‌سازی می‌شود.
        </p>

        <button type="submit" class="primary-btn">
          <span>باز کردن پنل مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else}
    <!-- Unlocked Private Manager Dashboard -->
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

    <!-- Filter Bar -->
    <section class="panel card-pad" style="margin-bottom: 18px;">
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
          <button type="button" class="quiet-btn" on:click={() => navigateTo('settings')}>
            تنظیمات سامانه
          </button>
        </div>
      </div>
    </section>

    <!-- Revenue Period KPIs -->
    <div class="kpi-grid">
      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">₿</span>
          <span>درآمد امروز ({toJalaliDate(todayISO)})</span>
        </div>
        <div class="kpi-value">{formatMoney(todayRevenue)} <small>تومان</small></div>
        <div class="kpi-sub">فروش ثبت‌شده روز جاری</div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">↗</span>
          <span>درآمد ۷ روز اخیر</span>
        </div>
        <div class="kpi-value">{formatMoney(weekRevenue)} <small>تومان</small></div>
        <div class="kpi-sub">از {toJalaliDate(sevenDaysAgoISO)} تا امروز</div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">▦</span>
          <span>درآمد ماه جاری شمسی</span>
        </div>
        <div class="kpi-value">{formatMoney(monthRevenue)} <small>تومان</small></div>
        <div class="kpi-sub">{formatJalaliYearMonthLabel(currentJalaliMonthKey)}</div>
      </section>

      <section class="panel kpi-card">
        <div class="card-topline">
          <span class="mini-icon">▤</span>
          <span>درآمد کل دوره انتخابی</span>
        </div>
        <div class="kpi-value">
          {formatMoney(financialOverview.totalRevenue)} <small>تومان</small>
        </div>
        <div class="kpi-sub">
          در {formatNumber(financialOverview.revenueDaysCount)} روز دارای ثبت فروش
        </div>
      </section>
    </div>

    <!-- Estimated Net Operating Balance & Financial Comparison -->
    <section class="panel card-pad" style="margin-bottom: 18px;">
      <div class="section-heading">
        <div>
          <h2>تراز عملیاتی: درآمد، خریدها، هزینه‌ها و مانده عملیاتی تخمینی</h2>
          <p>
            فرمول محاسبه: مانده عملیاتی تخمینی = کل درآمد ثبت‌شده − کل خریدهای ثبت‌شده − کل هزینه‌های جاری ثبت‌شده
          </p>
        </div>
      </div>

      <div class="kpi-grid" style="margin-bottom: 14px;">
        <div class="panel kpi-card">
          <div class="card-topline">
            <span class="mini-icon">＋</span>
            <span>کل درآمد ثبت‌شده (A)</span>
          </div>
          <div class="kpi-value">{formatMoney(financialOverview.totalRevenue)} <small>تومان</small></div>
          <div class="kpi-sub">{formatNumber(financialOverview.revenueDaysCount)} روز فروش</div>
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
            <strong>کل درآمد ثبت‌شده</strong>
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

    <!-- Daily & Monthly Revenue Charts -->
    <div class="two-col-grid" style="margin-bottom: 18px;">
      <section class="panel card-pad">
        <div class="section-heading">
          <div>
            <h2>نمودار درآمد روزانه (شمسی)</h2>
            <p>درآمد مؤثر روزهای اخیر به همراه نام روز هفته</p>
          </div>
        </div>

        {#if periodRevenueList.length > 0}
          {#each periodRevenueList as rev (rev.id)}
            {@const dayRev = getEffectiveDayRevenue(rev)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>
                  {getPersianWeekdayName(rev.date)} {toJalaliDate(rev.date)} ({toJalaliNumeric(rev.date)})
                </strong>
                <span>{formatMoney(dayRev)} تومان</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(6, Math.round((dayRev / maxDailyRev) * 100))}%;"
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
            <h2>نمودار درآمد ماهانه (شمسی)</h2>
            <p>مجموع درآمد به تفکیک ماه‌های تقویم جلالی</p>
          </div>
        </div>

        {#if monthlyRevenueList.length > 0}
          {#each monthlyRevenueList as item (item.ym)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>
                  {formatJalaliYearMonthLabel(item.ym)} ({formatNumber(item.days)} روز کاری)
                </strong>
                <span>{formatMoney(item.total)} تومان</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(6, Math.round((item.total / maxMonthlyRev) * 100))}%;"
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
