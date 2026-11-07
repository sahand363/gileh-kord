<script lang="ts">
  import {
    purchases,
    todayPurchasesStats,
    dashboardSummary,
    recentPurchases
  } from '../../stores/purchaseStore';
  import { navigateTo } from '../../stores/navigationStore';
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

  $: purchaseByDateColumns = (() => {
    const map = new Map<string, { date: string; total: number; count: number }>();
    for (const purchase of $purchases) {
      const item = map.get(purchase.purchaseDate) || { date: purchase.purchaseDate, total: 0, count: 0 };
      item.total += purchase.totalAmount;
      item.count += 1;
      map.set(purchase.purchaseDate, item);
    }
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7)
      .map((item): ColumnChartItem => ({
        id: `purchase-${item.date}`,
        label: getPersianWeekdayName(item.date),
        subLabel: toJalaliNumeric(item.date).slice(5),
        value: item.total,
        tone: 'primary'
      }));
  })();

  $: recentCount = $recentPurchases.length;
  $: lowStockCount = $dashboardSummary.lowStockItems.length;
</script>

<section class="page active dashboard-page" aria-labelledby="dashboardTitle">
  <header class="dashboard-hero">
    <div>
      <p class="eyebrow">پیشخوان عملیات رستوران</p>
      <h1 id="dashboardTitle">خوش آمدید به گیله‌کُرد</h1>
      <p>وضعیت خریدها، کالاها و فعالیت روزانه رستوران در یک نگاه.</p>
    </div>
    <div class="dashboard-hero-date">▦ &nbsp; {todayJalali}</div>
  </header>

  <div class="dashboard-kpis" aria-label="خلاصه وضعیت">
    <article class="panel dashboard-kpi">
      <div class="dashboard-kpi-head"><span>خرید امروز</span><span class="dashboard-kpi-icon">＋</span></div>
      <div class="dashboard-kpi-value">{formatMoney($todayPurchasesStats.total)} <small>تومان</small></div>
      <div class="dashboard-kpi-foot">{formatNumber($todayPurchasesStats.count)} فاکتور ثبت‌شده امروز</div>
    </article>
    <article class="panel dashboard-kpi">
      <div class="dashboard-kpi-head"><span>مجموع خریدها</span><span class="dashboard-kpi-icon">▤</span></div>
      <div class="dashboard-kpi-value">{formatMoney($dashboardSummary.totalPurchasesAmount)} <small>تومان</small></div>
      <div class="dashboard-kpi-foot">در {formatNumber($dashboardSummary.totalPurchasesCount)} فاکتور ثبت‌شده</div>
    </article>
    <article class="panel dashboard-kpi">
      <div class="dashboard-kpi-head"><span>کالاهای تعریف‌شده</span><span class="dashboard-kpi-icon">❖</span></div>
      <div class="dashboard-kpi-value">{formatNumber($dashboardSummary.productsCount)} <small>قلم کالا</small></div>
      <div class="dashboard-kpi-foot">قابل انتخاب در فرم ثبت خرید</div>
    </article>
    <article class="panel dashboard-kpi">
      <div class="dashboard-kpi-head"><span>هشدار موجودی</span><span class="dashboard-kpi-icon">◫</span></div>
      <div class="dashboard-kpi-value">{formatNumber(lowStockCount)} <small>قلم کالا</small></div>
      <div class="dashboard-kpi-foot">{lowStockCount > 0 ? 'نیازمند بررسی و تأمین مجدد' : 'موردی برای هشدار ثبت نشده است'}</div>
    </article>
  </div>

  <section class="dashboard-quick-actions" aria-label="عملیات سریع">
    <button class="dashboard-action" type="button" on:click={() => navigateTo('entry')}>
      <span class="dashboard-action-icon">＋</span><span><strong>ثبت خرید جدید</strong><small>ورود سریع فاکتور و اقلام</small></span>
    </button>
    <button class="dashboard-action" type="button" on:click={() => navigateTo('manager')}>
      <span class="dashboard-action-icon">◫</span><span><strong>مدیریت انبار و کالا</strong><small>بررسی موجودی و اطلاعات کالا</small></span>
    </button>
    <button class="dashboard-action" type="button" on:click={() => navigateTo('history')}>
      <span class="dashboard-action-icon">◷</span><span><strong>تاریخچه خریدها</strong><small>جست‌وجو و مرور فاکتورها</small></span>
    </button>
  </section>

  <div class="dashboard-main-grid">
    <section class="panel dashboard-panel">
      <div class="dashboard-panel-title">
        <div><h2>روند خریدهای اخیر</h2><p>مجموع مبالغ ثبت‌شده در هفت روز دارای خرید</p></div>
        <button class="dashboard-link" type="button" on:click={() => navigateTo('history')}>مشاهده تاریخچه ←</button>
      </div>
      {#if purchaseByDateColumns.length}
        <ColumnChart items={purchaseByDateColumns} height={205} />
      {:else}
        <div class="dashboard-empty-note">هنوز خریدی ثبت نشده است. با ثبت اولین فاکتور، نمودار فعالیت خرید در این قسمت نمایش داده می‌شود.</div>
      {/if}
    </section>

    <section class="panel dashboard-panel">
      <div class="dashboard-panel-title">
        <div><h2>وضعیت فعالیت</h2><p>نمای کلی اطلاعات ثبت‌شده در سامانه</p></div>
      </div>
      <div class="dashboard-list">
        <div class="dashboard-action"><span class="dashboard-action-icon">▤</span><span><strong>{formatNumber($dashboardSummary.totalPurchasesCount)} فاکتور خرید</strong><small>ثبت‌شده در سامانه</small></span></div>
        <div class="dashboard-action"><span class="dashboard-action-icon">❖</span><span><strong>{formatNumber($dashboardSummary.productsCount)} قلم کالا</strong><small>در فهرست کالاها</small></span></div>
        <div class="dashboard-action"><span class="dashboard-action-icon">◫</span><span><strong>{formatNumber(lowStockCount)} هشدار موجودی</strong><small>نیازمند توجه</small></span></div>
      </div>
      <p class="dashboard-footnote">این بخش فقط داده‌های موجود در سامانه را نمایش می‌دهد و عدد مالی تخمینی تولید نمی‌کند.</p>
    </section>
  </div>

  <section class="panel dashboard-panel">
    <div class="dashboard-panel-title">
      <div><h2>آخرین خریدها</h2><p>آخرین فاکتورهای ثبت‌شده در سامانه</p></div>
      <button class="dashboard-link" type="button" on:click={() => navigateTo('history')}>همه خریدها ←</button>
    </div>
    {#if recentCount > 0}
      <div class="dashboard-list">
        {#each $recentPurchases as purchase (purchase.id)}
          <PurchaseCard {purchase} />
        {/each}
      </div>
    {:else}
      <EmptyState title="هنوز خریدی ثبت نشده است" message="با ثبت اولین فاکتور، سوابق خرید در این قسمت نمایش داده می‌شوند." />
    {/if}
  </section>
</section>
