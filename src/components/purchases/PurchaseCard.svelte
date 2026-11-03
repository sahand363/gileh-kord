<script lang="ts">
  import type { Purchase } from '../../models/types';
  import {
    formatMoney,
    formatNumber,
    toJalaliDate,
    toJalaliNumeric
  } from '../../utils/formatters';
  import { getPersianWeekdayName } from '../../utils/jalali';
  import {
    appSettings,
    employeeByIdMap,
    resolvePurchaseEmployeeName
  } from '../../stores/purchaseStore';

  export let purchase: Purchase;

  $: avatarLetter = (purchase.productName || '؟').trim().charAt(0);
  $: employeeLabel = resolvePurchaseEmployeeName(purchase, $employeeByIdMap);
  $: hasEmployee = Boolean(purchase.employeeId);
  $: weekdayName = getPersianWeekdayName(purchase.purchaseDate);
</script>

<article class="purchase-item">
  <div class="product-avatar">{avatarLetter}</div>
  <div class="purchase-main">
    <div class="purchase-name">
      <span>{purchase.productName}</span>
      {#if $appSettings.showDemoBadges}
        {#if purchase.isDemo}
          <span class="badge-demo">نمونه آزمایشی</span>
        {:else}
          <span class="badge-real">ثبت واقعی</span>
        {/if}
      {/if}
      <span class={hasEmployee ? 'badge-employee' : 'badge-unassigned'}>
        خرید توسط: {employeeLabel}
      </span>
    </div>
    <div class="purchase-meta">
      <span>{formatNumber(purchase.quantity)} {purchase.unit}</span>
      {#if purchase.supplierName}
        <span>فروشنده: {purchase.supplierName}</span>
      {/if}
      {#if purchase.invoiceNumber}
        <span>فاکتور {purchase.invoiceNumber}</span>
      {/if}
      {#if purchase.notes}
        <span>({purchase.notes})</span>
      {/if}
    </div>
  </div>
  <div class="purchase-side">
    <div class="purchase-amount">{formatMoney(purchase.totalAmount)} تومان</div>
    <div class="purchase-date">
      {weekdayName ? `${weekdayName} ` : ''}{toJalaliDate(purchase.purchaseDate)}
      ({toJalaliNumeric(purchase.purchaseDate)})
    </div>
  </div>
</article>
