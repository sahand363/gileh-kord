<script lang="ts">
  import { onMount } from 'svelte';
  import {
    managerAuthService,
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
    syncSnapshots,
    refreshSnapshotsList,
    revertServerToSnapshot,
    syncLocalStateToServer,
    updateGlobalRevenueCoefficient,
    updateEmployee,
    saveDailyTotalRevenue,
    deleteDetailedRevenueEntry,
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
    formatLivePriceInput,
    getTodayISODate,
    parseNumericInput,
    toJalaliDate,
    toJalaliDateTime,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    calculateFinancialOverview,
    calculateStaffRevenueAllocations,
    filterRevenueRecords,
    getEffectiveDayRevenue
  } from '../../utils/calculations';
  import type { RevenueDayRecord } from '../../models/types';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  // Nested Management Sub-Modules (Dashboard is now Tab #1 inside Manager)
  import DashboardPage from '../dashboard/DashboardPage.svelte';
  import MenuPage from '../menu/MenuPage.svelte';
  import EmployeesPage from '../employees/EmployeesPage.svelte';
  import ExpensesPage from '../expenses/ExpensesPage.svelte';
  import InventoryPage from '../inventory/InventoryPage.svelte';
  import ProductsPage from '../products/ProductsPage.svelte';
  import SuppliersPage from '../suppliers/SuppliersPage.svelte';
  import BackupPage from '../backup/BackupPage.svelte';
  import SettingsPage from '../settings/SettingsPage.svelte';

  const MANAGER_TABS: Array<{ id: ManagerSubTab; label: string; icon: string }> = [
    { id: 'dashboard', label: 'پیشخوان', icon: '⊞' },
    { id: 'overview', label: 'درآمد و سهم کارکنان', icon: '₿' },
    { id: 'analytics', label: 'تحلیل ۷ روزه', icon: '↗' },
    { id: 'menu', label: 'منوی کافه', icon: '☕' },
    { id: 'employees', label: 'ثبت کارکنان و ضرایب', icon: '♟' },
    { id: 'expenses', label: 'هزینه‌ها', icon: '¤' },
    { id: 'inventory', label: 'انبار', icon: '◫' },
    { id: 'products', label: 'کالاها', icon: '❖' },
    { id: 'suppliers', label: 'تأمین‌کنندگان', icon: '◈' },
    { id: 'history_logs', label: 'تاریخچه و بازگشت', icon: '↺' },
    { id: 'backup', label: 'پشتیبان‌گیری', icon: '⇧' },
    { id: 'settings', label: 'تنظیمات', icon: '⚙' }
  ];

  let usernameInput = 'admin';
  let passwordInput = '';
  let authError = '';

  let frontendMultiplierInput = '0.6';
  let coeffError = '';

  let dateFrom = '';
  let dateTo = '';
  let onlyReal = false;

  // Inline Revenue Editing State
  let editingRevDate: string | null = null;
  let editRevTotal = '';
  let editRevCard = '';
  let editRevOnline = '';
  let editRevCash = '';
  let editRevNotes = '';
  let editRevError = '';

  $: frontendMultiplier = $appSettings.globalRevenueCoefficient ?? 0.6;

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      usernameInput = $activeManagerUsername;
    }
    frontendMultiplierInput = String($appSettings.globalRevenueCoefficient ?? 0.6);
    void refreshSnapshotsList();
  });

  $: last7DaysISOs = (() => {
    const days: string[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      days.push(getTodayISODate(d));
    }
    return days;
  })();

  $: last7DaysIncomeColumns = last7DaysISOs.map((iso): ColumnChartItem => {
    const revRec = $revenues.find((r) => r.date === iso && (!onlyReal || !r.isDemo));
    const incomeVal = revRec ? getEffectiveDayRevenue(revRec) : 0;
    return {
      id: `inc7_${iso}`,
      label: getPersianWeekdayName(iso),
      subLabel: toJalaliNumeric(iso).slice(5),
      value: incomeVal,
      tone: 'primary'
    };
  });

  $: last7DaysIncomeTotal = last7DaysIncomeColumns.reduce((s, c) => s + c.value, 0);

  $: last7DaysSpendingColumns = last7DaysISOs.map((iso): ColumnChartItem => {
    const dayPurchSum = $purchases
      .filter((p) => p.purchaseDate === iso && (!onlyReal || !p.isDemo))
      .reduce((s, p) => s + (Number(p.totalAmount) || 0), 0);
    const dayExpSum = $expenses
      .filter((e) => e.expenseDate === iso && (!onlyReal || !e.isDemo))
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    return {
      id: `spd7_${iso}`,
      label: getPersianWeekdayName(iso),
      subLabel: toJalaliNumeric(iso).slice(5),
      value: dayPurchSum + dayExpSum,
      tone: 'danger'
    };
  });

  $: last7DaysSpendingTotal = last7DaysSpendingColumns.reduce((s, c) => s + c.value, 0);

  $: filteredDailyRevenues = filterRevenueRecords(
    $revenues,
    dateFrom,
    dateTo,
    onlyReal
  );

  $: financialOverview = calculateFinancialOverview({
    revenues: $revenues,
    purchases: $purchases,
    expenses: $expenses,
    coefficient: frontendMultiplier,
    dateFrom,
    dateTo,
    onlyReal
  });

  $: managerFrontendRevenue = Math.round(
    financialOverview.totalRevenue * frontendMultiplier
  );

  $: staffAllocations = calculateStaffRevenueAllocations({
    employees: $employees,
    timesheets: $timesheets,
    totalRevenue: financialOverview.totalRevenue,
    dateFrom,
    dateTo,
    onlyReal
  });

  $: dailyRevenueColumns = filteredDailyRevenues
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

  $: staffRevenueColumns = staffAllocations.rows.map(
    (row): ColumnChartItem => ({
      id: row.employee.id,
      label: row.employee.name,
      subLabel: `${formatNumber(row.effectiveHours)} ساعت مؤثر (×${formatNumber(row.multiplier)})`,
      value: row.allocatedRevenue,
      tone: 'gold'
    })
  );

  function startEditRevenue(rev: RevenueDayRecord) {
    editingRevDate = rev.date;
    editRevTotal = formatLivePriceInput(getEffectiveDayRevenue(rev));
    editRevCard = rev.cardAmount ? formatLivePriceInput(rev.cardAmount) : '';
    editRevOnline = rev.onlineAmount ? formatLivePriceInput(rev.onlineAmount) : '';
    editRevCash = rev.cashAmount ? formatLivePriceInput(rev.cashAmount) : '';
    editRevNotes = rev.notes || '';
    editRevError = '';
  }

  function cancelEditRevenue() {
    editingRevDate = null;
    editRevError = '';
  }

  async function saveEditedRevenue(originalDate: string) {
    editRevError = '';
    const parsedTotal = parseNumericInput(editRevTotal);
    if (isNaN(parsedTotal) || parsedTotal <= 0) {
      editRevError = 'مبلغ کل درآمد باید عددی بزرگ‌تر از صفر باشد.';
      return;
    }

    const parsedCard = parseNumericInput(editRevCard);
    const parsedOnline = parseNumericInput(editRevOnline);
    const parsedCash = parseNumericInput(editRevCash);

    try {
      await saveDailyTotalRevenue({
        date: originalDate,
        dailyTotalAmount: parsedTotal,
        cardAmount: !isNaN(parsedCard) && parsedCard > 0 ? parsedCard : undefined,
        onlineAmount: !isNaN(parsedOnline) && parsedOnline > 0 ? parsedOnline : undefined,
        cashAmount: !isNaN(parsedCash) && parsedCash > 0 ? parsedCash : undefined,
        notes: editRevNotes
      });
      editingRevDate = null;
      showToast(`درآمد تاریخ ${toJalaliDate(originalDate)} با موفقیت ویرایش شد.`);
    } catch (err) {
      editRevError = err instanceof Error ? err.message : 'خطا در ویرایش درآمد.';
    }
  }

  async function handleLogin() {
    authError = '';
    const res = await managerAuthService.login(usernameInput, passwordInput);
    if (!res.success) {
      authError = res.error || 'نام کاربری یا رمز عبور مستر نادرست است.';
      return;
    }
    passwordInput = '';
    frontendMultiplierInput = String($appSettings.globalRevenueCoefficient ?? 0.6);
    void refreshSnapshotsList();
    showToast('ورود به بخش مدیریت انجام شد.');
  }

  async function handleSaveFrontendMultiplier() {
    coeffError = '';
    const parsed = parseNumericInput(frontendMultiplierInput);
    if (isNaN(parsed) || parsed <= 0 || parsed > 10) {
      coeffError = 'لطفاً ضریب معتبری وارد کنید (مثلاً ۰.۶).';
      return;
    }
    const saved = await updateGlobalRevenueCoefficient(parsed);
    frontendMultiplierInput = String(saved.globalRevenueCoefficient);
    showToast('ضریب نمایش درآمد در فرانت‌اند بروزرسانی شد.');
  }

  async function handleInlineMultiplierChange(empId: string, event: Event) {
    const target = event.currentTarget as HTMLInputElement;
    const rawVal = target?.value || '';
    const val = parseNumericInput(rawVal);
    if (isNaN(val) || val <= 0 || val > 10) {
      showToast('ضریب کارمند باید عددی بزرگ‌تر از صفر باشد.');
      return;
    }
    await updateEmployee(empId, { performanceCoefficient: val });
    showToast('ضریب کارمند بروزرسانی شد و سهم درآمد مجدداً محاسبه گردید.');
  }

  async function handleDeleteRevenueRecord(id: string, date: string) {
    const confirmed = window.confirm(
      `حذف درآمد ثبت‌شده برای تاریخ ${toJalaliDate(date)}؟`
    );
    if (!confirmed) return;
    await deleteRevenueDayRecord(id);
    showToast('رکورد درآمد حذف شد.');
  }

  async function handleManualFullSync() {
    await syncLocalStateToServer('همگام‌سازی دستی از پنل مدیریت');
    showToast('تمام اطلاعات این دستگاه روی سرور ذخیره و همگام شد.');
  }

  async function handleRevertSnapshot(snapId: string, summary: string) {
    const confirmed = window.confirm(
      `آیا مطمئن هستید که می‌خواهید تمام اطلاعات برنامه را به نسخه «${summary}» بازگردانید؟`
    );
    if (!confirmed) return;
    try {
      await revertServerToSnapshot(snapId);
      showToast('اطلاعات با موفقیت به نسخه انتخابی بازگردانده شد.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'خطا در بازگردانی نسخه.');
    }
  }

  function handleLockPanel() {
    managerAuthService.lock();
    showToast('بخش مدیریت قفل شد.');
  }
</script>

<section class="page active" aria-labelledby="managerTitle">
  {#if !$isManagerUnlocked}
    <div id="settingsLogin" class="panel login-panel">
      <div class="lock-mark">⌑</div>
      <h1 id="managerTitle" style="font-size: 19px; margin: 0;">ورود به بخش مدیریت</h1>
      <p>
        نام کاربری و رمز عبور مستر (تنظیم‌شده از طریق SSH) را وارد کنید.
      </p>

      <form id="loginForm" on:submit|preventDefault={handleLogin} novalidate>
        <div class="field">
          <label for="adminUser">نام کاربری مستر</label>
          <input
            id="adminUser"
            bind:value={usernameInput}
            autocomplete="username"
            required
          />
        </div>

        <div class="field">
          <label for="adminPass">رمز عبور مستر</label>
          <input
            id="adminPass"
            type="password"
            bind:value={passwordInput}
            placeholder="رمز عبور تنظیم‌شده در SSH"
            autocomplete="current-password"
            required
          />
        </div>

        {#if authError}
          <div class="form-error" role="alert">{authError}</div>
        {/if}

        <button type="submit" class="primary-btn">
          <span>ورود به بخش مدیریت</span>
          <span class="btn-arrow">←</span>
        </button>
      </form>
    </div>
  {:else}
    <!-- Top Menu inside Manager (directly under the main header) -->
    <nav class="manager-subnav" aria-label="منوی مدیریت">
      {#each MANAGER_TABS as tab (tab.id)}
        <button
          type="button"
          class="manager-tab-pill"
          class:active={$activeManagerTab === tab.id}
          on:click={() => {
            activeManagerTab.set(tab.id);
            if (tab.id === 'history_logs') {
              void refreshSnapshotsList();
            }
          }}
        >
          <span>{tab.icon}</span>
          <span>{tab.label}</span>
        </button>
      {/each}
    </nav>

    <div class="manager-top-bar panel">
      <div class="manager-top-info">
        <span class="badge-real">مدیر: {$activeManagerUsername}</span>
      </div>
      <div class="setting-actions">
        <button
          type="button"
          class="quiet-btn"
          on:click={handleManualFullSync}
        >
          ⇄ همگام‌سازی با سرور
        </button>
        <button
          id="adminLogout"
          type="button"
          class="secondary-btn"
          on:click={handleLockPanel}
        >
          ⌑ قفل مدیریت
        </button>
      </div>
    </div>

    {#if $activeManagerTab === 'dashboard'}
      <DashboardPage />
    {:else if $activeManagerTab === 'analytics'}
      <div class="two-col-grid" style="margin-bottom: 16px;">
        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>درآمد ۷ روز گذشته (روزبه‌روز)</h2>
              <p>مجموع درآمد ۷ روز اخیر: <strong>{formatMoney(last7DaysIncomeTotal)} تومان</strong></p>
            </div>
          </div>
          <ColumnChart items={last7DaysIncomeColumns} height={215} />
        </section>

        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>کل مخارج ۷ روز گذشته (روزبه‌روز)</h2>
              <p>مجموع خریدها و هزینه‌های ۷ روز اخیر: <strong>{formatMoney(last7DaysSpendingTotal)} تومان</strong></p>
            </div>
          </div>
          <ColumnChart items={last7DaysSpendingColumns} height={215} />
        </section>
      </div>

      <section class="panel card-pad">
        <div class="section-heading">
          <h2>جدول تفکیکی ۷ روز گذشته</h2>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>روز و تاریخ</th>
                <th>درآمد روز (تومان)</th>
                <th>کل مخارج روز (خرید + هزینه)</th>
                <th>مانده روز</th>
              </tr>
            </thead>
            <tbody>
              {#each last7DaysISOs as iso, idx (iso)}
                {@const dayInc = last7DaysIncomeColumns[idx].value}
                {@const daySpd = last7DaysSpendingColumns[idx].value}
                {@const dayNet = dayInc - daySpd}
                <tr>
                  <td>
                    <strong>{getPersianWeekdayName(iso)}</strong>
                    ({toJalaliNumeric(iso)})
                  </td>
                  <td><strong style="color: var(--green);">{formatMoney(dayInc)}</strong></td>
                  <td><strong style="color: var(--danger);">{formatMoney(daySpd)}</strong></td>
                  <td style="color: {dayNet >= 0 ? 'var(--green)' : 'var(--danger)'}; font-weight: 800;">
                    {formatMoney(dayNet)}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {:else if $activeManagerTab === 'overview'}
      <section class="panel card-pad" style="margin-bottom: 16px;">
        <div class="filters">
          <div class="date-filter">
            <span>از تاریخ</span>
            <div class="date-picker-filter-wrap">
              <JalaliDatePicker
                id="mgrDateFrom"
                bind:value={dateFrom}
                placeholder="ابتدای دوره"
                allowEmpty={true}
              />
            </div>
          </div>

          <div class="date-filter">
            <span>تا تاریخ</span>
            <div class="date-picker-filter-wrap">
              <JalaliDatePicker
                id="mgrDateTo"
                bind:value={dateTo}
                placeholder="انتهای دوره"
                allowEmpty={true}
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

      <div class="two-col-grid" style="margin-bottom: 16px;">
        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی درآمد</h2>
              <p>مجموع درآمد دوره: <strong>{formatMoney(financialOverview.totalRevenue)} تومان</strong></p>
            </div>
          </div>

          {#if dailyRevenueColumns.length > 0}
            <ColumnChart items={dailyRevenueColumns} height={205} />
          {:else}
            <EmptyState title="درآمدی ثبت نشده است" message="از تب درآمد فروش روزانه را ثبت کنید." />
          {/if}
        </section>

        <section class="panel card-pad">
          <div class="section-heading">
            <div>
              <h2>نمودار ستونی سهم درآمد هر کارمند</h2>
              <p>تخصیص متناسب با (ساعت کار × ضریب فردی)</p>
            </div>
          </div>

          {#if staffRevenueColumns.length > 0}
            <ColumnChart items={staffRevenueColumns} height={205} />
          {:else}
            <EmptyState title="کارمندی ثبت نشده است" message="از تب ثبت کارکنان و ضرایب، پرسنل را اضافه کنید." />
          {/if}
        </section>
      </div>

      <section class="panel card-pad" style="margin-bottom: 16px;">
        <div class="section-heading">
          <div>
            <h2>تخصیص درآمد به کارکنان بر اساس ضریب فردی</h2>
            <p>
              مثال: ۱۰ ساعت کار با ضریب ۰.۶ معادل ۶ ساعت کار مؤثر محاسبه شده و درآمد به نسبت ساعت مؤثر بین افراد تقسیم می‌شود.
            </p>
          </div>
          <button
            type="button"
            class="secondary-btn"
            on:click={() => activeManagerTab.set('employees')}
          >
            ＋ ثبت کارمند جدید
          </button>
        </div>

        {#if staffAllocations.rows.length > 0}
          <div class="table-scroll">
            <table class="data-table">
              <thead>
                <tr>
                  <th>نام کارمند</th>
                  <th>سمت</th>
                  <th>ساعت کار واقعی</th>
                  <th>ضریب کارمند (قابل ویرایش)</th>
                  <th>ساعت کار مؤثر (ساعت × ضریب)</th>
                  <th>درصد سهم</th>
                  <th>سهم درآمد تخصیص‌یافته (تومان)</th>
                </tr>
              </thead>
              <tbody>
                {#each staffAllocations.rows as row (row.employee.id)}
                  <tr>
                    <td><strong>{row.employee.name}</strong></td>
                    <td>{row.employee.role}</td>
                    <td>{formatNumber(row.rawHours)} ساعت</td>
                    <td>
                      <input
                        type="text"
                        dir="ltr"
                        value={row.multiplier}
                        style="width: 78px; height: 34px; text-align: center; font-weight: 800;"
                        aria-label={`ضریب ${row.employee.name}`}
                        on:change={(e) => handleInlineMultiplierChange(row.employee.id, e)}
                      />
                    </td>
                    <td><strong>{formatNumber(row.effectiveHours)} ساعت</strong></td>
                    <td>{formatNumber(Number((row.shareRatio * 100).toFixed(1)))}٪</td>
                    <td><strong style="color: var(--green);">{formatMoney(row.allocatedRevenue)} تومان</strong></td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <EmptyState title="کارمندی ثبت نشده است" message="از تب ثبت کارکنان، پرسنل را وارد کنید." />
        {/if}
      </section>

      <section class="panel card-pad coeff-editor-card" style="margin-bottom: 16px;">
        <div class="two-col-grid" style="align-items: center;">
          <div>
            <span class="eyebrow">بخش مجزا: محاسبه درآمد نمایشی در فرانت‌اند (× ۰.۶)</span>
            <h2 style="font-size: 16px; margin: 0 0 6px;">
              درآمد واقعی: <strong>{formatMoney(financialOverview.totalRevenue)} تومان</strong>
              ← درآمد نمایشی در فرانت‌اند (× {formatNumber(frontendMultiplier)}):
              <strong style="color: var(--green); font-size: 19px;">
                {formatMoney(managerFrontendRevenue)} تومان
              </strong>
            </h2>
          </div>

          <form
            on:submit|preventDefault={handleSaveFrontendMultiplier}
            class="coeff-form-row"
            novalidate
          >
            <label for="mgrFrontendMult" style="font-size: 11px; font-weight: 700;">
              ضریب فرانت‌اند:
            </label>
            <input
              id="mgrFrontendMult"
              inputmode="decimal"
              dir="ltr"
              bind:value={frontendMultiplierInput}
              class="coeff-input"
            />
            <button type="submit" class="secondary-btn" style="height: 44px;">
              ذخیره ضریب
            </button>
          </form>
        </div>
        {#if coeffError}
          <div class="form-error" role="alert" style="margin-top: 8px;">{coeffError}</div>
        {/if}
      </section>

      <!-- Full Recorded Revenue List with Inline Edit Support -->
      <section class="panel card-pad">
        <div class="section-heading">
          <h2>ریز درآمدهای ثبت‌شده ({formatNumber(filteredDailyRevenues.length)} روز)</h2>
        </div>

        <div class="purchase-list">
          {#if filteredDailyRevenues.length > 0}
            {#each filteredDailyRevenues as rev (rev.id)}
              {@const dayTotal = getEffectiveDayRevenue(rev)}
              {#if editingRevDate === rev.date}
                <div class="panel card-pad" style="border-color: var(--green-2);">
                  <div class="section-heading" style="margin-bottom: 12px;">
                    <h2>
                      ویرایش درآمد {getPersianWeekdayName(rev.date)} {toJalaliDate(rev.date)} ({toJalaliNumeric(rev.date)})
                    </h2>
                  </div>

                  <form on:submit|preventDefault={() => saveEditedRevenue(rev.date)} novalidate>
                    <div class="field">
                      <label for={`edit_rev_tot_${rev.id}`}>مبلغ کل روز (تومان)</label>
                      <input
                        id={`edit_rev_tot_${rev.id}`}
                        type="text"
                        dir="ltr"
                        inputmode="numeric"
                        value={editRevTotal}
                        on:input={(e) => {
                          const t = e.currentTarget;
                          editRevTotal = formatLivePriceInput(t.value);
                          t.value = editRevTotal;
                        }}
                        style="text-align: right;"
                        required
                      />
                    </div>

                    <div class="field-row">
                      <div class="field">
                        <label for={`edit_rev_card_${rev.id}`}>کارت‌خوان (اختیاری)</label>
                        <input
                          id={`edit_rev_card_${rev.id}`}
                          type="text"
                          dir="ltr"
                          inputmode="numeric"
                          value={editRevCard}
                          on:input={(e) => {
                            const t = e.currentTarget;
                            editRevCard = formatLivePriceInput(t.value);
                            t.value = editRevCard;
                          }}
                          style="text-align: right;"
                        />
                      </div>
                      <div class="field">
                        <label for={`edit_rev_online_${rev.id}`}>آنلاین (اختیاری)</label>
                        <input
                          id={`edit_rev_online_${rev.id}`}
                          type="text"
                          dir="ltr"
                          inputmode="numeric"
                          value={editRevOnline}
                          on:input={(e) => {
                            const t = e.currentTarget;
                            editRevOnline = formatLivePriceInput(t.value);
                            t.value = editRevOnline;
                          }}
                          style="text-align: right;"
                        />
                      </div>
                    </div>

                    <div class="field-row">
                      <div class="field">
                        <label for={`edit_rev_cash_${rev.id}`}>نقدی (اختیاری)</label>
                        <input
                          id={`edit_rev_cash_${rev.id}`}
                          type="text"
                          dir="ltr"
                          inputmode="numeric"
                          value={editRevCash}
                          on:input={(e) => {
                            const t = e.currentTarget;
                            editRevCash = formatLivePriceInput(t.value);
                            t.value = editRevCash;
                          }}
                          style="text-align: right;"
                        />
                      </div>
                      <div class="field">
                        <label for={`edit_rev_notes_${rev.id}`}>توضیحات</label>
                        <input id={`edit_rev_notes_${rev.id}`} bind:value={editRevNotes} />
                      </div>
                    </div>

                    {#if rev.mode === 'detailed' && rev.entries.length > 0}
                      <div style="margin-bottom: 12px; padding: 10px; background: #f5f8f5; border-radius: 10px;">
                        <strong style="font-size: 11px; display: block; margin-bottom: 6px;">
                          ریز اقلام ثبت‌شده این روز:
                        </strong>
                        {#each rev.entries as entry (entry.id)}
                          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px; padding: 4px 0;">
                            <span>{entry.description} ({entry.category}) — {formatMoney(entry.amount)} تومان</span>
                            <button
                              type="button"
                              class="quiet-btn"
                              on:click={() => deleteDetailedRevenueEntry(rev.date, entry.id)}
                            >
                              حذف ردیف
                            </button>
                          </div>
                        {/each}
                      </div>
                    {/if}

                    {#if editRevError}
                      <div class="form-error" role="alert">{editRevError}</div>
                    {/if}

                    <div class="setting-actions">
                      <button type="submit" class="secondary-btn">ذخیره تغییرات ✓</button>
                      <button type="button" class="quiet-btn" on:click={cancelEditRevenue}>
                        انصراف
                      </button>
                    </div>
                  </form>
                </div>
              {:else}
                <article class="purchase-item" style="flex-wrap: wrap;">
                  <div class="product-avatar">₿</div>
                  <div class="purchase-main">
                    <div class="purchase-name">
                      <span>
                        {getPersianWeekdayName(rev.date)} {toJalaliDate(rev.date)} ({toJalaliNumeric(rev.date)})
                      </span>
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
                      class="secondary-btn"
                      on:click={() => startEditRevenue(rev)}
                    >
                      ویرایش
                    </button>
                    <button
                      type="button"
                      class="quiet-btn"
                      on:click={() => handleDeleteRevenueRecord(rev.id, rev.date)}
                    >
                      حذف
                    </button>
                  </div>
                </article>
              {/if}
            {/each}
          {:else}
            <EmptyState title="درآمدی ثبت نشده است" message="رکوردهای درآمد در این بخش نمایش داده می‌شوند." />
          {/if}
        </div>
      </section>
    {:else if $activeManagerTab === 'menu'}
      <MenuPage />
    {:else if $activeManagerTab === 'history_logs'}
      <section class="panel history-panel">
        <div class="section-heading">
          <div>
            <h2>تاریخچه تغییرات کاربران و بازگشت به نسخه قبلی (Revert)</h2>
          </div>
          <button
            type="button"
            class="quiet-btn"
            on:click={() => refreshSnapshotsList()}
          >
            ↻ بروزرسانی فهرست
          </button>
        </div>

        <div class="purchase-list">
          {#if $syncSnapshots.length > 0}
            {#each $syncSnapshots as snap (snap.id)}
              <article class="purchase-item" style="flex-wrap: wrap;">
                <div class="product-avatar">↺</div>
                <div class="purchase-main">
                  <div class="purchase-name">
                    <span>{snap.actionSummary}</span>
                    <span class="badge-employee">توسط: {snap.actor}</span>
                  </div>
                  <div class="purchase-meta">
                    <span>زمان: {toJalaliDateTime(snap.timestamp)}</span>
                    <span>خریدها: {formatNumber(snap.counts?.purchases || 0)}</span>
                    <span>درآمد: {formatNumber(snap.counts?.revenues || 0)}</span>
                  </div>
                </div>
                <div class="purchase-side">
                  <button
                    type="button"
                    class="secondary-btn"
                    on:click={() => handleRevertSnapshot(snap.id, snap.actionSummary)}
                  >
                    ↺ بازگشت به این نسخه
                  </button>
                </div>
              </article>
            {/each}
          {:else}
            <EmptyState
              title="هنوز تاریخچه تغییری روی سرور ثبت نشده است"
              message="با ثبت تغییر یا زدن دکمه همگام‌سازی، نسخه‌های قابل بازگشت اینجا فهرست می‌شوند."
            />
          {/if}
        </div>
      </section>
    {:else if $activeManagerTab === 'employees'}
      <EmployeesPage />
    {:else if $activeManagerTab === 'expenses'}
      <ExpensesPage />
    {:else if $activeManagerTab === 'inventory'}
      <InventoryPage />
    {:else if $activeManagerTab === 'products'}
      <ProductsPage />
    {:else if $activeManagerTab === 'suppliers'}
      <SuppliersPage />
    {:else if $activeManagerTab === 'backup'}
      <BackupPage />
    {:else if $activeManagerTab === 'settings'}
      <SettingsPage />
    {/if}
  {/if}
</section>
