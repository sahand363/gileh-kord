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
    updateGlobalRevenueCoefficient,
    updateEmployee,
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
    parseNumericInput,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    calculateFinancialOverview,
    calculateStaffRevenueAllocations,
    filterRevenueRecords,
    getEffectiveDayRevenue
  } from '../../utils/calculations';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import JalaliDatePicker from '../../components/common/JalaliDatePicker.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  // Nested Management Sub-Modules
  import EmployeesPage from '../employees/EmployeesPage.svelte';
  import ExpensesPage from '../expenses/ExpensesPage.svelte';
  import InventoryPage from '../inventory/InventoryPage.svelte';
  import ProductsPage from '../products/ProductsPage.svelte';
  import SuppliersPage from '../suppliers/SuppliersPage.svelte';
  import BackupPage from '../backup/BackupPage.svelte';
  import SettingsPage from '../settings/SettingsPage.svelte';

  const MANAGER_TABS: Array<{ id: ManagerSubTab; label: string; icon: string }> = [
    { id: 'overview', label: 'درآمد و سهم کارکنان', icon: '₿' },
    { id: 'employees', label: 'ثبت کارکنان و ضرایب', icon: '♟' },
    { id: 'expenses', label: 'هزینه‌ها', icon: '¤' },
    { id: 'inventory', label: 'انبار', icon: '◫' },
    { id: 'products', label: 'کالاها', icon: '❖' },
    { id: 'suppliers', label: 'تأمین‌کنندگان', icon: '◈' },
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

  $: frontendMultiplier = $appSettings.globalRevenueCoefficient ?? 0.6;

  onMount(async () => {
    await managerAuthService.checkInitialized();
    if ($activeManagerUsername) {
      usernameInput = $activeManagerUsername;
    }
    frontendMultiplierInput = String($appSettings.globalRevenueCoefficient ?? 0.6);
  });

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

  async function handleLogin() {
    authError = '';
    const res = await managerAuthService.login(usernameInput, passwordInput);
    if (!res.success) {
      authError = res.error || 'نام کاربری یا رمز عبور مستر نادرست است.';
      return;
    }
    passwordInput = '';
    frontendMultiplierInput = String($appSettings.globalRevenueCoefficient ?? 0.6);
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
    <div class="manager-top-bar panel">
      <div class="manager-top-info">
        <span class="badge-real">مدیر: {$activeManagerUsername}</span>
        <strong>بخش مدیریت</strong>
      </div>
      <div class="setting-actions">
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
            <p style="margin: 0; font-size: 11px; color: var(--muted);">
              درآمد کل در ضریب <strong>{formatNumber(frontendMultiplier)}</strong> ضرب شده و عدد حاصل ({formatMoney(managerFrontendRevenue)} تومان) به عنوان درآمد در فرانت‌اند نمایش داده می‌شود.
            </p>
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

      <section class="panel card-pad">
        <div class="section-heading">
          <h2>ریز درآمدهای ثبت‌شده ({formatNumber(filteredDailyRevenues.length)} روز)</h2>
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
            <EmptyState title="درآمدی ثبت نشده است" message="رکوردهای درآمد در این بخش نمایش داده می‌شوند." />
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
