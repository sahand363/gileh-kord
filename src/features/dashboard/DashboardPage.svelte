<script lang="ts">
  import {
    purchases,
    todayPurchasesStats,
    dashboardSummary,
    recentPurchases
  } from '../../stores/purchaseStore';
  import { navigateTo, NAV_SECTIONS } from '../../stores/navigationStore';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric,
    getTodayISODate
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  const todayISO = getTodayISODate();
  const todayJalali = `${getPersianWeekdayName(todayISO)} ${toJalaliDate(todayISO)}`;

  // Build a 7-day purchase activity column chart (Zero revenue mentioned on public dashboard)
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
          value: d.total,
          tone: 'primary'
        })
      );
  })();
</script>

<section class="page active" aria-labelledby="dashboardTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">نمای سریع موبایل و دسکتاپ</p>
      <h1 id="dashboardTitle">پیشخوان گیله‌کُرد</h1>
      <p class="subheading">خلاصه وضعیت خریدهای روزانه، کالاها و هشدارهای موجودی انبار.</p>
    </div>
    <div class="heading-date">
      <span class="calendar-icon">▦</span>
      <span>{todayJalali}</span>
    </div>
  </div>

  <div class="kpi-grid">
    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">＋</span>
        <span>خرید امروز</span>
      </div>
      <div class="kpi-value">{formatMoney($todayPurchasesStats.total)} <small>تومان</small></div>
      <div class="kpi-sub">{formatNumber($todayPurchasesStats.count)} فاکتور امروز</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">▤</span>
        <span>کل فاکتورهای خرید</span>
      </div>
      <div class="kpi-value">{formatNumber($dashboardSummary.totalPurchasesCount)} <small>فاکتور</small></div>
      <div class="kpi-sub">مجموع کل: {formatMoney($dashboardSummary.totalPurchasesAmount)} تومان</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">❖</span>
        <span>کالاهای ثبت‌شده</span>
      </div>
      <div class="kpi-value">
        {formatNumber($dashboardSummary.productsCount)} <small>قلم کالا</small>
      </div>
      <div class="kpi-sub">آماده پیشنهاد خودکار در فرم خرید</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">◫</span>
        <span>هشدار کسری انبار</span>
      </div>
      <div class="kpi-value">
        {formatNumber($dashboardSummary.lowStockItems.length)} <small>قلم کالا</small>
      </div>
      <div class="kpi-sub">نیازمند تأمین و سفارش مجدد</div>
    </section>
  </div>

  <!-- Operational Purchases Column Chart (No revenue displayed) -->
  <section class="panel card-pad" style="margin-bottom: 16px;">
    <div class="section-heading">
      <div>
        <h2>نمودار ستونی خریدهای اخیر</h2>
        <p>مجموع مبالغ خرید روزهای اخیر به تاریخ شمسی</p>
      </div>
      <button type="button" class="text-btn" on:click={() => navigateTo('history')}>
        تاریخچه خریدها <span>←</span>
      </button>
    </div>

    {#if purchaseByDateColumns.length > 0}
      <ColumnChart items={purchaseByDateColumns} height={180} />
    {:else}
      <EmptyState
        title="خریدی ثبت نشده است"
        message="پس از ثبت خرید، نمودار ستونی خریدهای روزانه در این قسمت نمایش داده می‌شود."
      />
    {/if}
  </section>

  <section class="panel card-pad" style="margin-bottom: 16px;">
    <div class="section-heading">
      <div>
        <h2>آخرین خریدها</h2>
        <p>بروزرسانی زنده پس از هر ثبت خرید</p>
      </div>
      <button type="button" class="secondary-btn" on:click={() => navigateTo('entry')}>
        ＋ ثبت خرید
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
          message="از بخش ثبت خرید اولین فاکتور خود را وارد کنید."
        />
      {/if}
    </div>
  </section>

  <section class="recent-section">
    <div class="section-heading">
      <div>
        <h2>دسترسی سریع</h2>
        <p>تب‌های اصلی برنامه</p>
      </div>
    </div>
    <div class="quick-nav-grid">
      {#each NAV_SECTIONS as sec (sec.id)}
        <button
          type="button"
          class="quick-nav-btn"
          on:click={() => navigateTo(sec.id)}
        >
          <span class="quick-nav-icon">{sec.icon}</span>
          <div>
            <strong style="font-size: 12px; display: block;">{sec.label}</strong>
          </div>
        </button>
      {/each}
    </div>
  </section>
</section>
