<script lang="ts">
  import {
    todayPurchasesStats,
    dashboardSummary,
    recentPurchases,
    publicRevenueStore
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

  $: publicChartItems = $publicRevenueStore.dailySeries
    .slice(0, 7)
    .reverse()
    .map(
      (d): ColumnChartItem => ({
        id: d.id,
        label: getPersianWeekdayName(d.date),
        subLabel: toJalaliNumeric(d.date).slice(5),
        value: d.amount,
        tone: 'primary'
      })
    );
</script>

<section class="page active" aria-labelledby="dashboardTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">نمای سریع موبایل و دسکتاپ</p>
      <h1 id="dashboardTitle">پیشخوان گیله‌کُرد</h1>
      <p class="subheading">خلاصه خرید امروز، درآمد و وضعیت عملیاتی رستوران.</p>
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
        <span class="mini-icon">₿</span>
        <span>درآمد امروز</span>
      </div>
      <div class="kpi-value">{formatMoney($publicRevenueStore.todayAmount)} <small>تومان</small></div>
      <div class="kpi-sub">کل دوره: {formatMoney($publicRevenueStore.totalAmount)} تومان</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">▤</span>
        <span>کل خریدها</span>
      </div>
      <div class="kpi-value">{formatNumber($dashboardSummary.totalPurchasesCount)} <small>فاکتور</small></div>
      <div class="kpi-sub">{formatNumber($dashboardSummary.productsCount)} قلم کالای ثبت‌شده</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">⌑</span>
        <span>پنل مدیریت</span>
      </div>
      <div class="kpi-value" style="font-size: 15px;">محافظت‌شده 🔒</div>
      <div class="kpi-sub">
        <button
          type="button"
          class="text-btn"
          style="padding: 0; font-size: 10px;"
          on:click={() => navigateTo('manager')}
        >
          ورود با رمز مدیر ←
        </button>
      </div>
    </section>
  </div>

  <!-- Public Vertical Column Chart: Labeled simply "درآمد" -->
  <section class="panel card-pad" style="margin-bottom: 16px;">
    <div class="section-heading">
      <div>
        <h2>درآمد</h2>
        <p>نمودار ستونی درآمد روزهای اخیر (شمسی)</p>
      </div>
      <button type="button" class="text-btn" on:click={() => navigateTo('revenue')}>
        ثبت درآمد <span>←</span>
      </button>
    </div>

    {#if publicChartItems.length > 0}
      <ColumnChart items={publicChartItems} height={180} />
    {:else}
      <EmptyState
        title="درآمدی ثبت نشده است"
        message="پس از ثبت درآمد، نمودار ستونی در این قسمت نمایش داده می‌شود."
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
