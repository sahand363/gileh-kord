<script lang="ts">
  import {
    purchases,
    suppliers,
    expenses,
    dashboardSummary
  } from '../../stores/purchaseStore';
  import { formatMoney, formatNumber } from '../../utils/formatters';
  import { getTopPurchasedProducts } from '../../utils/calculations';
  import EmptyState from '../../components/common/EmptyState.svelte';

  $: topProducts = getTopPurchasedProducts($purchases, 6);
  $: maxProductSpend = topProducts.length > 0 ? topProducts[0].totalAmount : 1;

  $: sortedSuppliers = [...$suppliers]
    .sort((a, b) => b.totalPurchasesAmount - a.totalPurchasesAmount)
    .slice(0, 5);
  $: maxSupplierSpend =
    sortedSuppliers.length > 0 && sortedSuppliers[0].totalPurchasesAmount > 0
      ? sortedSuppliers[0].totalPurchasesAmount
      : 1;

  $: purchaseSharePercent =
    $dashboardSummary.combinedOutflow > 0
      ? Math.round(
          ($dashboardSummary.totalPurchasesAmount /
            $dashboardSummary.combinedOutflow) *
            100
        )
      : 0;
  $: expenseSharePercent =
    $dashboardSummary.combinedOutflow > 0 ? 100 - purchaseSharePercent : 0;
</script>

<section class="page active" aria-labelledby="reportsTitle">
  <div class="page-heading">
    <div>
      <p class="eyebrow">تحلیل مالی و تدارکات</p>
      <h1 id="reportsTitle">گزارش‌های مدیریتی</h1>
      <p class="subheading">
        خلاصه هزینه‌کرد رستوران به تفکیک اقلام پرمصرف، تأمین‌کنندگان اصلی و نسبت خرید مواد اولیه به هزینه‌های جاری.
      </p>
    </div>
  </div>

  <div class="three-col-grid" style="margin-bottom: 20px;">
    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">▤</span>
        <span>مجموع خرید مواد اولیه</span>
      </div>
      <div class="kpi-value">
        {formatMoney($dashboardSummary.totalPurchasesAmount)} <small>تومان</small>
      </div>
      <div class="kpi-sub">
        {formatNumber(purchaseSharePercent)}٪ از کل خروجی مالی ثبت‌شده
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
        {formatNumber(expenseSharePercent)}٪ از کل خروجی مالی ثبت‌شده ({formatNumber($expenses.length)} مورد)
      </div>
    </section>

    <section class="panel kpi-card">
      <div class="card-topline">
        <span class="mini-icon">↗</span>
        <span>جمع کل خروجی دوره</span>
      </div>
      <div class="kpi-value">
        {formatMoney($dashboardSummary.combinedOutflow)} <small>تومان</small>
      </div>
      <div class="kpi-sub">
        میانگین هر فاکتور خرید: {formatMoney($dashboardSummary.averagePurchaseAmount)} تومان
      </div>
    </section>
  </div>

  <div class="two-col-grid">
    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>بیشترین مبالغ خرید به تفکیک کالا</h2>
          <p>اقلامی که بیشترین سهم بودجه خرید را به خود اختصاص داده‌اند</p>
        </div>
      </div>

      {#if topProducts.length > 0}
        {#each topProducts as item (item.productName)}
          <div class="bar-row">
            <div class="bar-labels">
              <strong>{item.productName} ({formatNumber(item.count)} خرید)</strong>
              <span>{formatMoney(item.totalAmount)} تومان</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style="width: {Math.max(6, Math.round((item.totalAmount / maxProductSpend) * 100))}%;"
              ></div>
            </div>
          </div>
        {/each}
      {:else}
        <EmptyState
          title="داده‌ای برای نمایش وجود ندارد"
          message="پس از ثبت خرید، نمودار سهم هزینه‌کرد کالاها در این بخش نمایش داده می‌شود."
        />
      {/if}
    </section>

    <section class="panel card-pad">
      <div class="section-heading">
        <div>
          <h2>تأمین‌کنندگان برتر بر اساس حجم خرید</h2>
          <p>مقایسه میزان خرید ثبت‌شده از هر فروشنده</p>
        </div>
      </div>

      {#if sortedSuppliers.length > 0}
        {#each sortedSuppliers as sup (sup.id)}
          <div class="bar-row">
            <div class="bar-labels">
              <strong>{sup.name} ({sup.city})</strong>
              <span>{formatMoney(sup.totalPurchasesAmount)} تومان</span>
            </div>
            <div class="bar-track">
              <div
                class="bar-fill"
                style="width: {Math.max(6, Math.round((sup.totalPurchasesAmount / maxSupplierSpend) * 100))}%;"
              ></div>
            </div>
          </div>
        {/each}
      {:else}
        <EmptyState
          title="تأمین‌کننده‌ای ثبت نشده است"
          message="اطلاعات فروشندگان پس از ثبت در بخش تأمین‌کنندگان یا فاکتورهای خرید محاسبه می‌شود."
        />
      {/if}
    </section>
  </div>
</section>
