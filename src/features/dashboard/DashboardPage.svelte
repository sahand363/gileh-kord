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

  const todayISO = getTodayISODate();
  const todayJalali = `${getPersianWeekdayName(todayISO)} ${toJalaliDate(todayISO)} (${toJalaliNumeric(todayISO)})`;

  $: publicDailySeries = $publicRevenueStore.dailySeries.slice(0, 7);
  $: maxPublicDailyRev =
    publicDailySeries.length > 0
      ? Math.max(1, ...publicDailySeries.map((d) => d.amount))
      : 1;
</script>

<section class="page active" aria-labelledby="dashboardTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">نمای کلی عملیات روزانه رستوران</p>
      <h1 id="dashboardTitle">پیشخوان گیله‌کُرد</h1>
      <p class="subheading">
        خلاصه وضعیت خریدهای روزانه، درآمد، پرسنل فعال و هشدارهای موجودی انبار.
      </p>
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
        <span>خریدهای امروز</span>
      </div>
      <div class="kpi-value">{formatMoney($todayPurchasesStats.total)} <small>تومان</small></div>
      <div class="kpi-sub">{formatNumber($todayPurchasesStats.count)} فاکتور ثبت‌شده امروز</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">₿</span>
        <span>درآمد امروز</span>
      </div>
      <div class="kpi-value">{formatMoney($publicRevenueStore.todayAmount)} <small>تومان</small></div>
      <div class="kpi-sub">درآمد کل دوره: {formatMoney($publicRevenueStore.totalAmount)} تومان</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">◈</span>
        <span>کارکنان فعال</span>
      </div>
      <div class="kpi-value">
        {formatNumber($dashboardSummary.activeEmployeesCount)} <small>نفر</small>
      </div>
      <div class="kpi-sub">
        از مجموع {formatNumber($dashboardSummary.employeesCount)} کارمند ثبت‌شده
      </div>
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

  <!-- Public Revenue Chart: Labeled simply "درآمد" and showing ONLY calculated values -->
  <section class="panel card-pad" style="margin-bottom: 18px;">
    <div class="section-heading">
      <div>
        <h2>درآمد</h2>
        <p>روند درآمد روزانه به تاریخ شمسی</p>
      </div>
      <button type="button" class="text-btn" on:click={() => navigateTo('revenue')}>
        بخش درآمد <span>←</span>
      </button>
    </div>

    {#if publicDailySeries.length > 0}
      {#each publicDailySeries as item (item.id)}
        <div class="bar-row">
          <div class="bar-labels">
            <strong>
              {getPersianWeekdayName(item.date)} {toJalaliDate(item.date)} ({toJalaliNumeric(item.date)})
            </strong>
            <span>{formatMoney(item.amount)} تومان</span>
          </div>
          <div class="bar-track">
            <div
              class="bar-fill"
              style="width: {Math.max(
                6,
                Math.round((item.amount / maxPublicDailyRev) * 100)
              )}%;"
            ></div>
          </div>
        </div>
      {/each}
    {:else}
      <EmptyState
        title="درآمدی ثبت نشده است"
        message="پس از ثبت فروش روزانه، نمودار درآمد در این قسمت نمایش داده می‌شود."
      />
    {/if}
  </section>

  <div class="two-col-grid">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>آخرین خریدهای ثبت‌شده</h2>
          <p>بروزرسانی زنده به همراه نام کارمند مسئول خرید</p>
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
            message="از بخش ثبت خرید اولین فاکتور خود را وارد کنید."
          />
        {/if}
      </div>
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>هشدارهای موجودی انبار ({formatNumber($dashboardSummary.lowStockItems.length)})</h2>
          <p>اقلامی که موجودی آن‌ها کمتر از حد مجاز است</p>
        </div>
        <button type="button" class="text-btn" on:click={() => navigateTo('inventory')}>
          مدیریت انبار <span>←</span>
        </button>
      </div>

      <div class="purchase-list">
        {#if $dashboardSummary.lowStockItems.length > 0}
          {#each $dashboardSummary.lowStockItems as item (item.id)}
            <div class="purchase-item">
              <div class="product-avatar">!</div>
              <div class="purchase-main">
                <div class="purchase-name">
                  <span>{item.productName}</span>
                  <span class="badge-low">کمبود موجودی</span>
                </div>
                <div class="purchase-meta">
                  <span>موجودی فعلی: {formatNumber(item.currentStock)} {item.unit}</span>
                  <span>حداقل مجاز: {formatNumber(item.minStockThreshold)} {item.unit}</span>
                </div>
              </div>
              <button
                type="button"
                class="quiet-btn"
                on:click={() => navigateTo('entry')}
              >
                سفارش خرید
              </button>
            </div>
          {/each}
        {:else}
          <EmptyState
            title="موجودی همه اقلام کافی است"
            message="هیچ کالایی زیر نقطه سفارش قرار ندارد."
          />
        {/if}
      </div>
    </section>
  </div>

  <section class="recent-section">
    <div class="section-heading">
      <div>
        <h2>دسترسی سریع به ماژول‌های سامانه</h2>
        <p>تمامی بخش‌های عملیاتی، پرسنلی و مدیریتی گیله‌کُرد</p>
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
            <span style="font-size: 9px; color: var(--muted);">مشاهده بخش ←</span>
          </div>
        </button>
      {/each}
    </div>
  </section>
</section>
