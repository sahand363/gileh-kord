<script lang="ts">
  import {
    purchases,
    suppliers,
    expenses,
    dashboardSummary,
    publicRevenueStore
  } from '../../stores/purchaseStore';
  import { formatMoney, formatNumber } from '../../utils/formatters';
  import { getTopPurchasedProducts } from '../../utils/calculations';
  import EmptyState from '../../components/common/EmptyState.svelte';
  import ColumnChart, { type ColumnChartItem } from '../../components/common/ColumnChart.svelte';

  $: topProducts = getTopPurchasedProducts($purchases, 6);
  $: productColumnItems = topProducts.map(
    (item, idx): ColumnChartItem => ({
      id: `prod_col_${idx}`,
      label: item.productName,
      subLabel: `${item.count} خرید`,
      value: item.totalAmount,
      tone: 'primary'
    })
  );

  $: sortedSuppliers = [...$suppliers]
    .filter((s) => s.totalPurchasesAmount > 0)
    .sort((a, b) => b.totalPurchasesAmount - a.totalPurchasesAmount)
    .slice(0, 6);

  $: supplierColumnItems = sortedSuppliers.map(
    (s): ColumnChartItem => ({
      id: s.id,
      label: s.name,
      subLabel: s.city,
      value: s.totalPurchasesAmount,
      tone: 'gold'
    })
  );
</script>

<div class="reports-subview">
  <div class="three-col-grid" style="margin-bottom: 18px;">
    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">▤</span>
        <span>مجموع خرید مواد اولیه</span>
      </div>
      <div class="kpi-value">
        {formatMoney($dashboardSummary.totalPurchasesAmount)} <small>تومان</small>
      </div>
      <div class="kpi-sub">
        در {formatNumber($dashboardSummary.totalPurchasesCount)} فاکتور خرید
      </div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">¤</span>
        <span>مجموع هزینه‌های جاری</span>
      </div>
      <div class="kpi-value">
        {formatMoney($dashboardSummary.totalExpenses)} <small>تومان</small>
      </div>
      <div class="kpi-sub">
        ثبت‌شده در {formatNumber($expenses.length)} ردیف هزینه
      </div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">₿</span>
        <span>درآمد (نمای عمومی)</span>
      </div>
      <div class="kpi-value">
        {formatMoney($publicRevenueStore.totalAmount)} <small>تومان</small>
      </div>
      <div class="kpi-sub">
        در {formatNumber($publicRevenueStore.daysCount)} روز ثبت‌شده
      </div>
    </section>
  </div>

  <div class="two-col-grid">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>نمودار ستونی پرهزینه‌ترین کالاها</h2>
          <p>اقلامی که بیشترین سهم بودجه خرید را داشته‌اند</p>
        </div>
      </div>

      {#if productColumnItems.length > 0}
        <ColumnChart items={productColumnItems} height={200} />
      {:else}
        <EmptyState
          title="داده‌ای برای نمایش وجود ندارد"
          message="پس از ثبت خرید، نمودار ستونی کالاها در این بخش نمایش داده می‌شود."
        />
      {/if}
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>نمودار ستونی تأمین‌کنندگان برتر</h2>
          <p>مقایسه حجم خرید از هر فروشنده</p>
        </div>
      </div>

      {#if supplierColumnItems.length > 0}
        <ColumnChart items={supplierColumnItems} height={200} />
      {:else}
        <EmptyState
          title="تأمین‌کننده‌ای ثبت نشده است"
          message="اطلاعات فروشندگان پس از ثبت فاکتورهای خرید محاسبه می‌شود."
        />
      {/if}
    </section>
  </div>
</div>
