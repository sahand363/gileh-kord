<script lang="ts">
  import type { Purchase } from '../../models/types';
  import { formatMoney, formatNumber, toJalaliDate } from '../../utils/formatters';
  import { appSettings } from '../../stores/purchaseStore';

  export let purchase: Purchase;

  $: avatarLetter = (purchase.productName || '؟').trim().charAt(0);
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
    <div class="purchase-date">{toJalaliDate(purchase.purchaseDate)}</div>
  </div>
</article>
