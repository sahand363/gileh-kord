<script lang="ts">
  import {
    todayPurchasesStats,
    dashboardSummary,
    recentPurchases
  } from '../../stores/purchaseStore';
  import { navigateTo, NAV_SECTIONS } from '../../stores/navigationStore';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    getTodayISODate
  } from '../../utils/formatters';
  import PurchaseCard from '../../components/purchases/PurchaseCard.svelte';
  import EmptyState from '../../components/common/EmptyState.svelte';

  const todayJalali = toJalaliDate(getTodayISODate());
</script>

<section class="page active" aria-labelledby="dashboardTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">نمای کلی عملیات رستوران</p>
      <h1 id="dashboardTitle">پیشخوان مدیریت گیله‌کُرد</h1>
      <p class="subheading">خلاصه وضعیت خریدهای روزانه، موجودی انبار، هزینه‌ها و دسترسی سریع به ماژول‌ها.</p>
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
        <span class="mini-icon">▤</span>
        <span>کل خریدهای دوره</span>
      </div>
      <div class="kpi-value">{formatMoney($dashboardSummary.totalPurchasesAmount)} <small>تومان</small></div>
      <div class="kpi-sub">از مجموع {formatNumber($dashboardSummary.totalPurchasesCount)} خرید ثبت‌شده</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">◫</span>
        <span>هشدار کسری انبار</span>
      </div>
      <div class="kpi-value">{formatNumber($dashboardSummary.lowStockItems.length)} <small>قلم کالا</small></div>
      <div class="kpi-sub">نیازمند تأمین و سفارش مجدد</div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">¤</span>
        <span>هزینه‌های جانبی</span>
      </div>
      <div class="kpi-value">{formatMoney($dashboardSummary.totalExpenses)} <small>تومان</small></div>
      <div class="kpi-sub">قبوض، حمل‌ونقل و تعمیرات</div>
    </section>
  </div>

  <div class="two-col-grid">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>آخرین خریدهای ثبت‌شده</h2>
          <p>بروزرسانی زنده پس از هر ثبت خرید</p>
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
          <h2>هشدارهای موجودی انبار</h2>
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
        <p>تمامی بخش‌های عملیاتی و مدیریتی گیله‌کُرد</p>
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
