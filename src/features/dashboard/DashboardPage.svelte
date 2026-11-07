<script lang="ts">
  import {
    purchases,
    todayPurchasesStats,
    dashboardSummary,
    recentPurchases,
    appSettings
  } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
  import {
    formatReportingMoney,
    getCurrencyLabel,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate
  } from '../../utils/formatters';
  import {
    formatJalaliYearMonthLabel,
    getJalaliYearMonthKey,
    getPersianWeekdayName
  } from '../../utils/jalali';
  import {
    calculatePurchaseStats,
    getTopPurchasedProducts
  } from '../../utils/calculations';
  import type { ReportingCurrency } from '../../models/types';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  const todayISO = getTodayISODate();
  const currentMonthKey = getJalaliYearMonthKey(todayISO);
  const currentMonthLabel = formatJalaliYearMonthLabel(currentMonthKey);
  const todayJalali = `${getPersianWeekdayName(todayISO)} ${toJalaliDate(todayISO)}`;

  $: repCurr = ($appSettings.reportingCurrency || 'TOMAN') as ReportingCurrency;
  $: currLabel = getCurrencyLabel(repCurr);
  $: scaleMultiplier = repCurr === 'RIAL' ? 10 : 1;

  // Monthly purchase overview (current Jalali month)
  $: currentMonthPurchases = $purchases.filter(
    (p) => getJalaliYearMonthKey(p.purchaseDate) === currentMonthKey
  );
  $: monthlyPurchaseStats = calculatePurchaseStats(currentMonthPurchases);

  // Frequently purchased products
  $: frequentProducts = getTopPurchasedProducts($purchases, 5);
  $: maxProductAmount =
    frequentProducts.length > 0 && frequentProducts[0].totalAmount > 0
      ? frequentProducts[0].totalAmount
      : 1;

  // 7-day purchase column chart
  $: purchaseByDateColumns = (() => {
    const map = new Map<string, { date: string; total: number; count: number }>();
    for (const p of $purchases) {
      const existing = map.get(p.purchaseDate) || {
        date: p.purchaseDate,
        total: 0,
        count: 0
      };
      existing.total += p.totalAmount;
      existing.count += 1;
      map.set(p.purchaseDate, existing);
    }
    return Array.from(map.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 7)
      .reverse()
      .map(
        (d): ColumnChartItem => ({
          id: `purch_day_${d.date}`,
          label: getPersianWeekdayName(d.date),
          subLabel: toJalaliNumeric(d.date).slice(5),
          value: d.total * scaleMultiplier,
          tone: 'primary'
        })
      );
  })();
</script>

<section class="page active" aria-labelledby="dashboardTitle">
  <!-- Refined Welcome & Quick Action Hero -->
  <div class="dashboard-hero panel">
    <div class="hero-main">
      <p class="eyebrow">پیشخوان عملیاتی تدارکات • {todayJalali}</p>
      <h1 id="dashboardTitle">{$appSettings.restaurantName || 'رستوران گیله‌کُرد'}</h1>
      <p class="subheading">
        نمای لحظه‌ای خریدهای روزانه، مرور تدارکات ماه {currentMonthLabel} و اقلام پرمصرف آشپزخانه (واحد گزارش: <strong>{currLabel}</strong>).
      </p>
    </div>

    <div class="hero-actions">
      <button type="button" class="primary-btn hero-cta" on:click={() => navigateTo('entry')}>
        <span>＋ ثبت خرید جدید</span>
      </button>
      <button type="button" class="secondary-btn" on:click={() => navigateTo('products')}>
        ❖ کالاها
      </button>
      <button type="button" class="quiet-btn" on:click={() => navigateTo('history')}>
        ▤ تاریخچه خریدها
      </button>
    </div>
  </div>

  <!-- 4 Financial & Operational Summary Cards -->
  <div class="kpi-grid">
    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">＋</span>
        <span>مجموع خرید امروز</span>
      </div>
      <div class="kpi-value">
        {formatReportingMoney($todayPurchasesStats.total, repCurr)}
        <small>{currLabel}</small>
      </div>
      <div class="kpi-sub">
        {formatNumber($todayPurchasesStats.count)} فاکتور ثبت‌شده در {toJalaliDate(todayISO)}
      </div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">▦</span>
        <span>مرور خرید ماه ({currentMonthLabel})</span>
      </div>
      <div class="kpi-value">
        {formatReportingMoney(monthlyPurchaseStats.total, repCurr)}
        <small>{currLabel}</small>
      </div>
      <div class="kpi-sub">
        {formatNumber(monthlyPurchaseStats.count)} فاکتور | میانگین: {formatReportingMoney(monthlyPurchaseStats.average, repCurr)} {currLabel}
      </div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">❖</span>
        <span>کالاها و کل تدارکات</span>
      </div>
      <div class="kpi-value">
        {formatNumber($dashboardSummary.productsCount)}
        <small>قلم کالا</small>
      </div>
      <div class="kpi-sub">
        در {formatNumber($dashboardSummary.totalPurchasesCount)} فاکتور ثبت‌شده
      </div>
    </section>

    <section class="panel kpi-card" class:alert-card={$dashboardSummary.lowStockItems.length > 0}>
      <div class="card-topline">
        <span class="mini-icon">◫</span>
        <span>هشدار کسری موجودی</span>
      </div>
      <div class="kpi-value">
        {formatNumber($dashboardSummary.lowStockItems.length)}
        <small>قلم کالا</small>
      </div>
      <div class="kpi-sub">
        {$dashboardSummary.lowStockItems.length > 0
          ? 'نیازمند بررسی و سفارش مجدد'
          : 'موجودی اقلام دارای هشدار کافی است'}
      </div>
    </section>
  </div>

  <!-- Two-Column Analytics: Compact Purchase Chart & Frequently Purchased Products -->
  <div class="two-col-grid" style="margin-bottom: 18px;">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>روند خریدهای اخیر ({currLabel})</h2>
          <p>مجموع خرید روزهای اخیر به تاریخ شمسی</p>
        </div>
        <button type="button" class="text-btn" on:click={() => navigateTo('history')}>
          تاریخچه کامل <span>←</span>
        </button>
      </div>

      {#if purchaseByDateColumns.length > 0}
        <ColumnChart
          items={purchaseByDateColumns}
          height={185}
          unitLabel={currLabel}
        />
      {:else}
        <EmptyState
          title="هنوز خریدی ثبت نشده است"
          message="پس از ثبت اولین فاکتور خرید، نمودار روند روزانه در این بخش ترسیم می‌شود."
        />
      {/if}
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>پرتکرارترین و پرهزینه‌ترین کالاها</h2>
          <p>اقلام اصلی تدارکات آشپزخانه بر پایه حجم خرید</p>
        </div>
        <button type="button" class="text-btn" on:click={() => navigateTo('products')}>
          فهرست کالاها <span>←</span>
        </button>
      </div>

      {#if frequentProducts.length > 0}
        <div class="freq-products-list">
          {#each frequentProducts as prod (prod.productName)}
            <div class="bar-row">
              <div class="bar-labels">
                <strong>
                  {prod.productName}
                  <small style="color: var(--muted); font-weight: 500;">
                    ({formatNumber(prod.count)} مرتبه)
                  </small>
                </strong>
                <span>{formatReportingMoney(prod.totalAmount, repCurr)} {currLabel}</span>
              </div>
              <div class="bar-track">
                <div
                  class="bar-fill"
                  style="width: {Math.max(
                    8,
                    Math.round((prod.totalAmount / maxProductAmount) * 100)
                  )}%;"
                ></div>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <EmptyState
          title="کالایی ثبت نشده است"
          message="با ثبت فاکتورهای خرید، اقلام پرمصرف رستوران به صورت خودکار رتبه‌بندی می‌شوند."
        />
      {/if}
    </section>
  </div>

  <!-- Recent Purchases Section -->
  <section class="panel card-pad">
    <div class="section-heading">
      <div>
        <h2>آخرین خریدهای ثبت‌شده</h2>
        <p>امکان ویرایش مستقیم هر فاکتور از طریق دکمه «ویرایش»</p>
      </div>
      <button type="button" class="secondary-btn" on:click={() => navigateTo('entry')}>
        ＋ ثبت خرید جدید
      </button>
    </div>

    <div class="purchase-list">
      {#if $recentPurchases.length > 0}
        {#each $recentPurchases as purchase (purchase.id)}
          <PurchaseCard {purchase} />
        {/each}
      {:else}
        <EmptyState
          title="هنوز خریدی ثبت نشده است"
          message="از دکمه بالا اولین فاکتور خرید روزانه را ثبت کنید."
        />
      {/if}
    </div>
  </section>
</section>
